import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType, PaymentMethod, Prisma } from '@prisma/client';
import { buildSaleReceipt } from '../../common/escpos.util';

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

interface ListSalesFilters {
  search?: string;
  from?: string;
  to?: string;
  status?: string;
  limit?: number;
}

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.$transaction(async (tx) => {
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

        if (!isLoose && product.stock < Math.ceil(qty)) {
          throw new BadRequestException(`Insufficient stock for ${product.name}`);
        }

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
          await tx.product.update({
            where: { id: product.id },
            data: { stock: Math.max(0, product.stock - stockDeduct) },
          });
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

      // Sequential per-tenant invoice number (e.g. INV-00001).
      const saleCount = await tx.sale.count({ where: { tenantId } });
      const invoiceNumber = `INV-${String(saleCount + 1).padStart(5, '0')}`;

      let ncf: string | null = null;
      if (NCF_GENERATING_TYPES.includes(data.ncfType)) {
        const seq = await tx.nCFSequence.findUnique({
          where: { tenantId_type: { tenantId, type: data.ncfType } },
        });
        if (seq) {
          ncf = `${seq.prefix}${seq.nextValue.toString().padStart(8, '0')}`;
          await tx.nCFSequence.update({
            where: { id: seq.id },
            data: { nextValue: seq.nextValue + 1 },
          });
        }
      }

      const sale = await tx.sale.create({
        data: {
          tenantId,
          invoiceNumber,
          subtotal,
          total,
          cashReceived,
          changeDue,
          ncf,
          ncfType: data.ncfType,
          clientRnc: data.clientRnc?.replace(/\D/g, '') || null,
          clientName: data.clientName?.trim() || null,
          itbis,
          applyItbis: shouldApplyItbis,
          paymentMethod,
          status: 'COMPLETED',
          cashSessionId: openSession.id,
          items: { create: saleItemsData },
        },
        include: { items: { include: { product: true } }, tenant: true },
      });

      const receiptRaw = buildSaleReceipt(sale);
      return { sale, receiptRaw };
    });
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
