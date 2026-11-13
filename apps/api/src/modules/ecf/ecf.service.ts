import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PronesoftClient } from './pronesoft.client';
import { encryptSecret, decryptSecret } from './ecf-crypto.util';
import { NcfType, Prisma } from '@prisma/client';

const MAX_ATTEMPTS = 10;
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

// DGII payment forms: 1 efectivo, 2 cheque/transferencia, 3 tarjeta.
const PAYMENT_FORM_MAP: Record<string, string> = {
  CASH: '1',
  TRANSFER: '2',
  CARD: '3',
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

    const config = await this.prisma.tenantEcfConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        enabled: data.enabled ?? false,
        environment: data.environment ?? 'sandbox',
        clientId: data.clientId!,
        clientSecretEnc: secretEnc!,
      },
      update: {
        enabled: data.enabled,
        environment: data.environment,
        clientId: data.clientId,
        ...(secretEnc ? { clientSecretEnc: secretEnc } : {}),
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
    } catch (err) {
      this.logger.error(`e-CF worker tick failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.workerRunning = false;
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

      const payload = this.buildPayload(sale, config.environment);

      const response = await this.pronesoft.submit(
        {
          tenantId: config.tenantId,
          environment: config.environment,
          clientId: config.clientId,
          clientSecret: decryptSecret(config.clientSecretEnc),
        },
        payload,
      );

      const trackId =
        (response.trackId as string) ??
        (response.track_id as string) ??
        (response.id as string) ??
        null;

      await this.prisma.$transaction([
        this.prisma.ecfSubmission.update({
          where: { id: submissionId },
          data: { status: 'SENT', trackId, lastError: null, payload: payload as Prisma.InputJsonValue },
        }),
        this.prisma.sale.update({
          where: { id: submission.saleId },
          data: { ecfStatus: 'SENT', ecfTrackId: trackId },
        }),
      ]);
      this.logger.log(`e-CF SENT for sale ${submission.saleId} (trackId=${trackId})`);
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

  private buildPayload(sale: SaleWithRelations, environment: string): Record<string, unknown> {
    const invoiceType = INVOICE_TYPE_MAP[sale.ncfType] ?? '32';

    const taxable = sale.applyItbis
      ? parseFloat((sale.total - sale.itbis).toFixed(2))
      : 0;
    const exempt = sale.applyItbis ? 0 : sale.total;

    return {
      // Sandbox requires environment "TesteCF" in the body per Pronesoft docs.
      ...(environment !== 'prod' ? { environment: 'TesteCF' } : {}),
      invoiceType,
      issueDate: sale.createdAt.toISOString().slice(0, 10),
      paymentType: 1, // contado
      issuerRNC: sale.tenant.rnc,
      issuerBusinessName: sale.tenant.commercialName || sale.tenant.name,
      issuerAddress: sale.tenant.address || undefined,
      buyer: sale.clientRnc
        ? { taxId: sale.clientRnc, name: sale.clientName || undefined }
        : undefined,
      items: sale.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.price,
        unitOfMeasure: item.product.uom || 'Unidad',
      })),
      totals: {
        taxableAmount: taxable,
        exemptAmount: parseFloat(exempt.toFixed(2)),
        totalITBIS: sale.itbis,
        totalAmount: sale.total,
      },
      paymentForms: [
        {
          method: PAYMENT_FORM_MAP[sale.paymentMethod] ?? '1',
          amount: sale.total,
        },
      ],
      // Internal reference for reconciliation on webhooks/queries.
      additional_info: { internalInvoice: sale.invoiceNumber, internalNcf: sale.ncf },
    };
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
