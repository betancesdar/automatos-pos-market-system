import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PronesoftClient } from './pronesoft.client';
import { encryptSecret, decryptSecret } from './ecf-crypto.util';
import { NcfType, Prisma } from '@prisma/client';

const MAX_ATTEMPTS = 10;
// Solo estos tipos fiscales generan e-CF y llaman a Pronesoft. Las ventas de
// contado SIN comprobante fiscal (VENTA_RAPIDA) y SIN_NCF NO llaman a la API:
// se facturan localmente y nunca se envían a la DGII por e-CF.
const FISCAL_NCF_TYPES: NcfType[] = [
  NcfType.CONSUMIDOR_FINAL,
  NcfType.CREDITO_FISCAL,
  NcfType.GUBERNAMENTAL,
  NcfType.REGISTRO_UNICO_INGRESO,
];

// e-CF invoice types (DGII): 31 crédito fiscal, 32 consumo, 45 gubernamental.
const INVOICE_TYPE_MAP: Partial<Record<NcfType, string>> = {
  [NcfType.CREDITO_FISCAL]: '31',
  [NcfType.CONSUMIDOR_FINAL]: '32',
  [NcfType.REGISTRO_UNICO_INGRESO]: '32',
  [NcfType.GUBERNAMENTAL]: '45',
};

// DGII payment forms: 1 efectivo, 2 cheque/transferencia, 3 tarjeta, 4 venta a crédito.
const PAYMENT_FORM_MAP: Record<string, string> = {
  CASH: '1',
  TRANSFER: '2',
  CARD: '3',
  CREDIT: '4',
};

type SaleWithRelations = Prisma.SaleGetPayload<{
  include: { items: { include: { product: true } }; tenant: true };
}>;

@Injectable()
export class EcfService {
  private readonly logger = new Logger(EcfService.name);
  private workerRunning = false;

  constructor(
    private prisma: PrismaService,
    private pronesoft: PronesoftClient,
  ) {}

  // ───────────────────────── config per tenant ─────────────────────────

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantEcfConfig.findUnique({ where: { tenantId } });
    if (!config) return { enabled: false, environment: 'sandbox', clientId: '', hasSecret: false };
    return {
      enabled: config.enabled,
      environment: config.environment,
      clientId: config.clientId,
      hasSecret: Boolean(config.clientSecretEnc),
      updatedAt: config.updatedAt,
    };
  }

  async upsertConfig(
    tenantId: string,
    data: { enabled?: boolean; environment?: string; clientId?: string; clientSecret?: string },
  ) {
    if (data.environment && !['sandbox', 'prod'].includes(data.environment)) {
      throw new BadRequestException('environment must be "sandbox" or "prod"');
    }

    const existing = await this.prisma.tenantEcfConfig.findUnique({ where: { tenantId } });

    if (!existing && (!data.clientId || !data.clientSecret)) {
      throw new BadRequestException(
        'clientId y clientSecret son requeridos para configurar e-CF por primera vez',
      );
    }

    const secretEnc = data.clientSecret ? encryptSecret(data.clientSecret) : undefined;

    // No usamos upsert: Prisma valida la rama `create` aunque se tome `update`,
    // y clientSecretEnc es obligatorio en create. Al togglear enabled/environment
    // sin reenviar el secret, upsert fallaría. Create solo cuando no existe.
    const config = existing
      ? await this.prisma.tenantEcfConfig.update({
          where: { tenantId },
          data: {
            ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
            ...(data.environment ? { environment: data.environment } : {}),
            ...(data.clientId ? { clientId: data.clientId } : {}),
            ...(secretEnc ? { clientSecretEnc: secretEnc } : {}),
          },
        })
      : await this.prisma.tenantEcfConfig.create({
          data: {
            tenantId,
            enabled: data.enabled ?? false,
            environment: data.environment ?? 'sandbox',
            clientId: data.clientId!,
            clientSecretEnc: secretEnc!,
          },
        });

    // Credentials changed → drop any cached token.
    this.pronesoft.invalidateToken(tenantId);

    return this.getConfigView(config);
  }

  private getConfigView(config: { enabled: boolean; environment: string; clientId: string }) {
    return { enabled: config.enabled, environment: config.environment, clientId: config.clientId };
  }

  // ───────────────────────── enqueue (post-commit) ─────────────────────────

  /**
   * Queues a sale for e-CF emission. Called AFTER the sale transaction has
   * committed, always wrapped in try/catch by callers — a sale must NEVER
   * fail or block because of electronic invoicing.
   */
  async enqueueSale(sale: { id: string; tenantId: string; ncfType: NcfType }) {
    if (!FISCAL_NCF_TYPES.includes(sale.ncfType)) return;

    const config = await this.prisma.tenantEcfConfig.findUnique({
      where: { tenantId: sale.tenantId },
    });
    if (!config?.enabled) return;

    await this.prisma.$transaction([
      this.prisma.ecfSubmission.upsert({
        where: { saleId: sale.id },
        create: { tenantId: sale.tenantId, saleId: sale.id },
        update: {},
      }),
      this.prisma.sale.update({
        where: { id: sale.id },
        data: { ecfStatus: 'QUEUED' },
      }),
    ]);
    this.logger.log(`e-CF queued for sale ${sale.id} (tenant ${sale.tenantId})`);
  }

  // ───────────────────────── worker ─────────────────────────

  @Interval(30_000)
  async processQueue() {
    if (this.workerRunning) return; // no overlapping runs
    this.workerRunning = true;
    try {
      const batch = await this.prisma.ecfSubmission.findMany({
        where: {
          status: { in: ['QUEUED', 'FAILED'] },
          attempts: { lt: MAX_ATTEMPTS },
          nextRetryAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true },
      });

      for (const { id } of batch) {
        // Claim: single-statement guard against double processing.
        const claimed = await this.prisma.ecfSubmission.updateMany({
          where: { id, status: { in: ['QUEUED', 'FAILED'] } },
          data: { status: 'PROCESSING' },
        });
        if (claimed.count === 0) continue;
        await this.processSubmission(id);
      }

      await this.pollPendingStatuses();
    } catch (err) {
      this.logger.error(`e-CF worker tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.workerRunning = false;
    }
  }

  /**
   * Consulta en la DGII (vía Pronesoft) el estado legal de los e-CF ya enviados
   * que aún no tienen resultado. Espacia las consultas ~1 min. No afecta la venta.
   */
  private async pollPendingStatuses() {
    const pending = await this.prisma.ecfSubmission.findMany({
      where: {
        status: 'SENT',
        legalStatus: null,
        documentId: { not: null },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    for (const sub of pending) {
      try {
        const config = await this.prisma.tenantEcfConfig.findUnique({ where: { tenantId: sub.tenantId } });
        if (!config?.enabled) continue;

        const res = await this.pronesoft.status(
          {
            tenantId: config.tenantId,
            environment: config.environment,
            clientId: config.clientId,
            clientSecret: decryptSecret(config.clientSecretEnc),
          },
          sub.documentId!,
        );

        const legalStatus = (res.legalStatus as string) ?? null;
        const trackId = (res.trackId as string) ?? sub.trackId ?? null;
        const encf = (res.encf as string) ?? sub.encf ?? null;

        await this.prisma.ecfSubmission.update({
          where: { id: sub.id },
          data: {
            legalStatus,
            trackId,
            encf,
            response: res as Prisma.InputJsonValue,
            // vuelve a consultar en 1 min si la DGII aún no responde
            nextRetryAt: new Date(Date.now() + 60_000),
          },
        });

        if (legalStatus) {
          await this.prisma.sale.update({
            where: { id: sub.saleId },
            data: { ecfStatus: legalStatus, ecfTrackId: trackId ?? encf },
          });
          this.logger.log(`e-CF ${sub.saleId}: DGII ${legalStatus} (trackId=${trackId})`);
        }
      } catch (err) {
        // Consultar estado nunca debe tumbar el worker; reintenta luego.
        await this.prisma.ecfSubmission.update({
          where: { id: sub.id },
          data: { nextRetryAt: new Date(Date.now() + 120_000) },
        }).catch(() => undefined);
        this.logger.warn(`e-CF status poll falló (${sub.saleId}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async processSubmission(submissionId: string) {
    const submission = await this.prisma.ecfSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) return;

    try {
      const sale = await this.prisma.sale.findUnique({
        where: { id: submission.saleId },
        include: { items: { include: { product: true } }, tenant: true },
      });
      if (!sale) throw new Error('Sale no longer exists');
      if (sale.status === 'VOIDED') {
        // Don't emit e-CF for voided sales; park the submission.
        await this.prisma.ecfSubmission.update({
          where: { id: submissionId },
          data: { status: 'FAILED', lastError: 'Venta anulada — no se emite e-CF', attempts: MAX_ATTEMPTS },
        });
        return;
      }

      const config = await this.prisma.tenantEcfConfig.findUnique({
        where: { tenantId: submission.tenantId },
      });
      if (!config?.enabled) throw new Error('e-CF deshabilitado para el tenant');

      const payload = this.buildPayload(sale);

      // Guardar el payload antes de enviar: queda inspeccionable aunque el envío
      // falle (útil para depurar credenciales o validaciones de Pronesoft).
      await this.prisma.ecfSubmission.update({
        where: { id: submissionId },
        data: { payload: payload as Prisma.InputJsonValue },
      });

      const response = await this.pronesoft.submit(
        {
          tenantId: config.tenantId,
          environment: config.environment,
          clientId: config.clientId,
          clientSecret: decryptSecret(config.clientSecretEnc),
        },
        payload,
      );

      // Respuesta 201: { id (uuid Pronesoft), status:"REGISTERED", encf, trackId? ... }.
      // El trackId de la DGII llega después al consultar estado.
      const documentId = (response.id as string) ?? null;
      const encf = (response.encf as string) ?? null;
      const trackId = (response.trackId as string) ?? null;

      await this.prisma.$transaction([
        this.prisma.ecfSubmission.update({
          where: { id: submissionId },
          data: {
            status: 'SENT',
            documentId,
            encf,
            trackId,
            lastError: null,
            payload: payload as Prisma.InputJsonValue,
            response: response as Prisma.InputJsonValue,
            nextRetryAt: new Date(),
          },
        }),
        this.prisma.sale.update({
          where: { id: submission.saleId },
          data: { ecfStatus: 'SENT', ecfTrackId: encf ?? trackId },
        }),
      ]);
      this.logger.log(`e-CF enviado: sale ${submission.saleId} → Pronesoft id=${documentId} encf=${encf}`);
    } catch (err) {
      const attempts = submission.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      // Exponential backoff: 2^attempts minutes, capped at 4h.
      const delayMin = Math.min(Math.pow(2, attempts), 240);
      await this.prisma.$transaction([
        this.prisma.ecfSubmission.update({
          where: { id: submissionId },
          data: {
            status: 'FAILED',
            attempts,
            lastError: message.slice(0, 1000),
            nextRetryAt: new Date(Date.now() + delayMin * 60_000),
          },
        }),
        this.prisma.sale.update({
          where: { id: submission.saleId },
          data: { ecfStatus: 'FAILED' },
        }),
      ]);
      this.logger.warn(`e-CF attempt ${attempts} failed for sale ${submission.saleId}: ${message}`);
    }
  }

  // ───────────────────────── payload mapping ─────────────────────────

  /**
   * Construye el payload del e-CF según https://docs.ecf.pronesoft.com/ecf/send.
   *
   * IMPORTANTE: el POS guarda precios CON ITBIS incluido, pero el e-CF exige la
   * base gravable (sin impuesto) por línea + el ITBIS aparte. Aquí convertimos
   * cada línea de precio tax-inclusive a base + impuesto, y los totales se suman
   * de las líneas para que siempre reconcilien.
   *
   * No se envía el emisor en el body: Pronesoft lo toma de la empresa autenticada.
   * El e-NCF (invoiceNumber) se omite: en sandbox lo asigna Pronesoft; en
   * producción las secuencias se administran en su portal.
   */
  private buildPayload(sale: SaleWithRelations): Record<string, unknown> {
    const invoiceType = INVOICE_TYPE_MAP[sale.ncfType] ?? '32';

    const round = (n: number) => parseFloat(n.toFixed(2));

    let taxableTotal = 0;
    let itbisTotal = 0;
    const items = sale.items.map((item) => {
      const ratePct = sale.applyItbis ? item.product.taxPercentage ?? 0 : 0;
      const rate = ratePct / 100;
      const lineGross = item.price * item.quantity; // con ITBIS
      const lineTaxable = rate > 0 ? lineGross / (1 + rate) : lineGross;
      const lineItbis = lineGross - lineTaxable;
      const unitTaxable = rate > 0 ? item.price / (1 + rate) : item.price;

      taxableTotal += lineTaxable;
      itbisTotal += lineItbis;

      // billingIndicator DGII: 1=18%, 2=16%, 3=0%, 4=Exento.
      const billingIndicator = ratePct === 18 ? '1' : ratePct === 16 ? '2' : rate > 0 ? '3' : '4';

      return {
        lineNumber: sale.items.indexOf(item) + 1,
        name: item.product.name.slice(0, 80),
        type: item.product.type === 'SERVICE' ? '2' : '1',
        billingIndicator,
        quantity: item.quantity,
        unitPrice: round(unitTaxable),
        amount: round(lineTaxable),
      };
    });

    taxableTotal = round(taxableTotal);
    itbisTotal = round(itbisTotal);
    const totalAmount = round(taxableTotal + itbisTotal);

    // Reconciliación informativa: si hubo descuento a nivel de venta, el total
    // de líneas puede diferir del total cobrado. Se registra para auditoría.
    if (Math.abs(totalAmount - sale.total) > 0.05) {
      this.logger.warn(
        `e-CF sale ${sale.id}: total de líneas ${totalAmount} ≠ total de la venta ${sale.total} (¿descuento?)`,
      );
    }

    // buyer: requerido para crédito fiscal (31) y gubernamental (45); opcional en
    // consumo (32). Se incluye cuando hay RNC/nombre.
    const buyer =
      sale.clientRnc || sale.clientName
        ? {
            ...(sale.clientRnc ? { taxId: sale.clientRnc } : {}),
            name: sale.clientName || 'CONSUMIDOR FINAL',
          }
        : undefined;

    const payload: Record<string, unknown> = {
      version: '1.0',
      invoiceType,
      issueDate: sale.createdAt.toISOString(),
      items,
      totals: {
        taxableAmount: taxableTotal,
        itbisRate1: 0.18,
        totalITBIS: itbisTotal,
        totalAmount,
      },
      paymentForms: [
        { method: PAYMENT_FORM_MAP[sale.paymentMethod] ?? '1', amount: totalAmount },
      ],
    };
    if (buyer) payload.buyer = buyer;
    return payload;
  }

  // ───────────────────────── queries / retry ─────────────────────────

  async listSubmissions(tenantId: string, status?: string) {
    return this.prisma.ecfSubmission.findMany({
      where: { tenantId, ...(status && status !== 'ALL' ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        sale: { select: { invoiceNumber: true, ncf: true, total: true, createdAt: true } },
      },
    });
  }

  async retrySubmission(tenantId: string, submissionId: string) {
    const submission = await this.prisma.ecfSubmission.findFirst({
      where: { id: submissionId, tenantId },
    });
    if (!submission) throw new NotFoundException('Emisión no encontrada');
    if (submission.status === 'SENT') {
      throw new BadRequestException('Esta emisión ya fue enviada con éxito');
    }
    return this.prisma.ecfSubmission.update({
      where: { id: submissionId },
      data: { status: 'QUEUED', attempts: 0, nextRetryAt: new Date(), lastError: null },
    });
  }
}
