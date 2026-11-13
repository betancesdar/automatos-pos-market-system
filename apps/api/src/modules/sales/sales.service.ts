import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType, PaymentMethod, Prisma } from '@prisma/client';
import { buildSaleReceipt } from '../../common/escpos.util';
import { EcfService } from '../ecf/ecf.service';

const ITBIS_RATE = 0.18;

const NCF_GENERATING_TYPES: NcfType[] = [
  NcfType.CONSUMIDOR_FINAL,
  NcfType.CREDITO_FISCAL,
  NcfType.GUBERNAMENTAL,
  NcfType.REGISTRO_UNICO_INGRESO,
];

interface CheckoutItem {
  productId: string;
  quantity: number;
  unitPrice?: number;
  isLoose?: boolean;
}

interface CheckoutData {
  items: CheckoutItem[];
  cashReceived: number;
  ncfType: NcfType;
  applyItbis?: boolean;
  clientRnc?: string;
  clientName?: string;
  paymentMethod?: PaymentMethod;
  discountAmount?: number;
}

export interface OfflineSalePayload extends CheckoutData {
  /** Client-generated UUID — must be stable across sync retries for idempotency. */
  offlineId: string;
  /** ISO timestamp captured on-device at the moment the offline sale happened. */
  offlineCreatedAt?: string;
}

export interface SyncSaleResult {
  offlineId: string;
  status: 'synced' | 'duplicate' | 'error';
  saleId?: string;
  invoiceNumber?: string | null;
  error?: string;
}

interface ListSalesFilters {
  search?: string;
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private prisma: PrismaService,
    private ecfService: EcfService,
  ) {}

  /**
   * Post-commit, fire-and-forget e-CF enqueue. GOLDEN RULE: a sale never
   * fails, blocks, or slows down because of electronic invoicing.
   */
  enqueueEcfSafe(sale: { id: string; tenantId: string; ncfType: NcfType }) {
    this.ecfService.enqueueSale(sale).catch((err) => {
      this.logger.warn(
        `e-CF enqueue failed for sale ${sale.id} (non-blocking): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  async checkout(tenantId: string, data: CheckoutData, userId: string) {
    // ── Cash Register Audit: a checkout can only happen inside an OPEN cash session ──
    const openSession = await this.prisma.cashSession.findFirst({
      where: { tenantId, userId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!openSession) {
      throw new BadRequestException(
        'No hay una caja abierta. Debes realizar la Apertura de Caja antes de vender.',
      );
    }

    const result = await this.prisma.$transaction((tx) =>
      this.processSale(tx, tenantId, data, { cashSessionId: openSession.id }),
    );

    this.enqueueEcfSafe(result.sale);
    return result;
  }

  /**
   * Processes offline-queued sales submitted by the POS once connectivity is
   * restored. Each sale is keyed by a client-generated `offlineId`: if that
   * ID already exists in the DB the sale is skipped (idempotent — never
   * double-charges or double-deducts stock), otherwise it is processed with
   * the exact same logic/validation as a live `checkout()`.
   */
  async syncOfflineSales(tenantId: string, sales: OfflineSalePayload[], userId: string): Promise<SyncSaleResult[]> {
    const results: SyncSaleResult[] = [];

    // Best-effort cash session link: offline sales may be synced after the
    // shift that produced them was already closed, so we don't block sync on
    // an OPEN session — we just attach the user's most recent session if any.
    const lastSession = await this.prisma.cashSession.findFirst({
      where: { tenantId, userId },
      orderBy: { openedAt: 'desc' },
    });

    for (const saleData of sales) {
      if (!saleData.offlineId) {
        results.push({ offlineId: '', status: 'error', error: 'Missing offlineId' });
        continue;
      }

      try {
        const existing = await this.prisma.sale.findUnique({ where: { offlineId: saleData.offlineId } });
        if (existing) {
          results.push({
            offlineId: saleData.offlineId,
            status: 'duplicate',
            saleId: existing.id,
            invoiceNumber: existing.invoiceNumber,
          });
          continue;
        }

        const { sale } = await this.prisma.$transaction((tx) =>
          this.processSale(tx, tenantId, saleData, {
            cashSessionId: lastSession?.id ?? null,
            offlineId: saleData.offlineId,
            createdAtOverride: saleData.offlineCreatedAt ? new Date(saleData.offlineCreatedAt) : undefined,
          }),
        );

        this.enqueueEcfSafe(sale);
        results.push({ offlineId: saleData.offlineId, status: 'synced', saleId: sale.id, invoiceNumber: sale.invoiceNumber });
      } catch (err) {
        results.push({
          offlineId: saleData.offlineId,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Core sale-processing logic shared by live checkout, offline sync, and
   * the biller/cashier order checkout (OrdersService).
   * Must run inside a `$transaction` — validates stock, computes totals,
   * generates invoice/NCF numbers, deducts stock, and builds the ESC/POS
   * receipt. Stock, invoiceNumber and NCF all use single-statement atomic
   * updates (row locks) so concurrent checkouts never collide.
   */
  async processSale(
    tx: Prisma.TransactionClient,
    tenantId: string,
    data: CheckoutData,
    opts: { cashSessionId: string | null; offlineId?: string; createdAtOverride?: Date },
  ) {
    let subtotal = 0;
      const saleItemsData: {
        productId: string;
        quantity: number;
        price: number;
        cost: number;
        isLoose: boolean;
      }[] = [];

      for (const item of data.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.tenantId !== tenantId) {
          throw new BadRequestException(`Product ${item.productId} not found`);
        }

        const unitPrice = item.unitPrice ?? product.price;
        const qty = item.quantity;
        const isLoose = item.isLoose ?? unitPrice !== product.price;
        const lineTotal = unitPrice * qty;

        subtotal += lineTotal;
        saleItemsData.push({
          productId: product.id,
          quantity: qty,
          price: unitPrice,
          cost: product.cost,
          isLoose,
        });

        if (!isLoose && qty > 0) {
          const stockDeduct = Math.ceil(qty);
          // Atomic check-and-decrement: the WHERE clause guarantees we never
          // oversell under concurrent checkouts (no read-then-write race).
          const updated = await tx.$executeRaw`
            UPDATE "Product" SET stock = stock - ${stockDeduct}
            WHERE id = ${product.id} AND stock >= ${stockDeduct}`;
          if (updated === 0) {
            throw new BadRequestException(`Insufficient stock for ${product.name}`);
          }
        }
      }

      subtotal = parseFloat(subtotal.toFixed(2));

      const discount = Math.min(Math.max(data.discountAmount ?? 0, 0), subtotal);
      const netSubtotal = parseFloat((subtotal - discount).toFixed(2));

      let itbis = 0;
      const shouldApplyItbis = data.applyItbis ?? false;
      if (shouldApplyItbis) {
        const taxableAmount = netSubtotal / (1 + ITBIS_RATE);
        itbis = parseFloat((netSubtotal - taxableAmount).toFixed(2));
      }

      const total = netSubtotal;
      const paymentMethod = data.paymentMethod ?? PaymentMethod.CASH;

      if (paymentMethod === PaymentMethod.CASH && data.cashReceived < total) {
        throw new BadRequestException('Cash received is less than total');
      }

      const cashReceived = paymentMethod === PaymentMethod.CASH ? data.cashReceived : total;
      const changeDue = parseFloat((cashReceived - total).toFixed(2));

      if (data.ncfType === NcfType.CREDITO_FISCAL) {
        const rnc = data.clientRnc?.replace(/\D/g, '') ?? '';
        if (rnc.length !== 9 && rnc.length !== 11) {
          throw new BadRequestException('Valid RNC is required for CREDITO_FISCAL (9 or 11 digits)');
        }
      }

      // Sequential per-tenant invoice number (e.g. INV-00001), from an atomic
      // counter — count()+1 collided under concurrency and broke on deletes.
      const invoiceRows = await tx.$queryRaw<{ invoiceCounter: number }[]>`
        UPDATE "Tenant" SET "invoiceCounter" = "invoiceCounter" + 1
        WHERE id = ${tenantId}
        RETURNING "invoiceCounter"`;
      if (!invoiceRows.length) {
        throw new BadRequestException('Tenant not found');
      }
      const invoiceNumber = `INV-${String(invoiceRows[0].invoiceCounter).padStart(5, '0')}`;

      let ncf: string | null = null;
      if (NCF_GENERATING_TYPES.includes(data.ncfType)) {
        // Single-statement increment with row lock: two concurrent fiscal
        // sales can never receive the same NCF.
        const seqRows = await tx.$queryRaw<{ prefix: string; nextValue: number }[]>`
          UPDATE "NCFSequence"
          SET "nextValue" = "nextValue" + 1, "updatedAt" = NOW()
          WHERE "tenantId" = ${tenantId} AND "type" = ${data.ncfType}::"NcfType"
          RETURNING prefix, "nextValue"`;
        if (seqRows.length) {
          const used = seqRows[0].nextValue - 1;
          ncf = `${seqRows[0].prefix}${used.toString().padStart(8, '0')}`;
        } else {
          this.logger.warn(
            `Venta fiscal sin secuencia NCF configurada (tenant=${tenantId}, type=${data.ncfType}) — se emite sin NCF`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          tenantId,
          invoiceNumber,
          offlineId: opts.offlineId,
          subtotal,
          total,
          cashReceived,
          changeDue,
          totalReceived: cashReceived,
          totalChange: changeDue,
          ncf,
          ncfType: data.ncfType,
          clientRnc: data.clientRnc?.replace(/\D/g, '') || null,
          clientName: data.clientName?.trim() || null,
          itbis,
          applyItbis: shouldApplyItbis,
          paymentMethod,
          status: 'COMPLETED',
          cashSessionId: opts.cashSessionId,
          ...(opts.createdAtOverride ? { createdAt: opts.createdAtOverride } : {}),
          items: { create: saleItemsData },
        },
        include: { items: { include: { product: true } }, tenant: true },
      });

    const receiptRaw = buildSaleReceipt(sale);
    return { sale, receiptRaw };
  }

  /** Lists invoices/sales for the admin dashboard, with search + date range filters. */
  async listSales(tenantId: string, filters: ListSalesFilters = {}) {
    const where: Prisma.SaleWhereInput = { tenantId };

    if (filters.status && filters.status !== 'ALL') {
      where.status = filters.status;
    }

    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.from);
      if (filters.to) {
        const end = new Date(filters.to);
        end.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = end;
      }
    }

    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { ncf: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
        { clientRnc: { contains: search, mode: 'insensitive' } },
      ];
    }

    const sales = await this.prisma.sale.findMany({
      where,
      include: { items: { include: { product: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: filters.limit && filters.limit > 0 ? Math.min(filters.limit, 500) : 200,
    });

    return sales;
  }

  async getSale(tenantId: string, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      include: { items: { include: { product: { select: { name: true } } } }, tenant: true },
    });
    if (!sale) throw new NotFoundException('Factura no encontrada');
    return sale;
  }

  /**
   * Voids a sale (Anular Factura): flips status to VOIDED, restores stock
   * for every non-loose item, and records the reason + timestamp.
   */
  async voidSale(tenantId: string, saleId: string, voidReason: string) {
    const reason = voidReason?.trim();
    if (!reason) {
      throw new BadRequestException('Debe indicar el motivo de la anulación');
    }

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, tenantId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundException('Factura no encontrada');
      if (sale.status === 'VOIDED') {
        throw new BadRequestException('Esta factura ya fue anulada');
      }

      // Restore stock for physical (non-loose) items.
      for (const item of sale.items) {
        if (!item.isLoose && item.quantity > 0) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: Math.ceil(item.quantity) } },
          });
        }
      }

      return tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: reason,
        },
        include: { items: { include: { product: { select: { name: true } } } } },
      });
    });
  }
}
