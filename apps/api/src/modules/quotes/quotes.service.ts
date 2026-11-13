import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { NcfType, Prisma, QuoteStatus } from '@prisma/client';

export interface QuoteItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  isLoose?: boolean;
}
export interface QuoteInput {
  customerId?: string | null;
  clientName?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  ncfType?: NcfType;
  items: QuoteItemInput[];
}

const QUOTE_INCLUDE = {
  items: true,
  customer: { select: { id: true, name: true, docType: true, docNumber: true, phone: true } },
} satisfies Prisma.QuoteInclude;

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
  ) {}

  /** Precia los ítems contra el catálogo del tenant y calcula totales (ITBIS incluido). */
  private async priceItems(tenantId: string, items: QuoteItemInput[]) {
    if (!items?.length) throw new BadRequestException('La cotización necesita al menos un ítem');
    const products = await this.prisma.product.findMany({
      where: { tenantId, id: { in: items.map((i) => i.productId) } },
      select: { id: true, name: true, price: true, taxPercentage: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    let total = new Prisma.Decimal(0);
    let itbis = new Prisma.Decimal(0);
    const itemsData = items.map((i) => {
      const p = map.get(i.productId);
      if (!p) throw new BadRequestException('Producto inválido en la cotización');
      if (i.quantity <= 0) throw new BadRequestException(`Cantidad inválida para ${p.name}`);
      const unitPrice = new Prisma.Decimal(i.unitPrice ?? p.price);
      const lineTotal = unitPrice.mul(i.quantity);
      const rate = new Prisma.Decimal(p.taxPercentage ?? 0);
      // Precio es tax-inclusive: itbis = total * rate/(100+rate)
      const lineItbis = rate.gt(0)
        ? lineTotal.mul(rate).div(new Prisma.Decimal(100).add(rate))
        : new Prisma.Decimal(0);
      total = total.add(lineTotal);
      itbis = itbis.add(lineItbis);
      return {
        productId: p.id,
        productName: p.name,
        quantity: i.quantity,
        unitPrice,
        isLoose: i.isLoose ?? false,
      };
    });
    return { itemsData, total, itbis, subtotal: total.sub(itbis) };
  }

  async list(tenantId: string, opts?: { status?: string; search?: string }) {
    await this.expireStale(tenantId);
    const where: Prisma.QuoteWhereInput = { tenantId };
    if (opts?.status && opts.status !== 'ALL') where.status = opts.status as QuoteStatus;
    const term = opts?.search?.trim();
    if (term) {
      const digits = term.replace(/\D/g, '');
      where.OR = [
        { clientNameSnapshot: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        ...(digits ? [{ number: parseInt(digits, 10) }] : []),
      ];
    }
    return this.prisma.quote.findMany({ where, include: QUOTE_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async get(tenantId: string, id: string) {
    const quote = await this.prisma.quote.findFirst({ where: { id, tenantId }, include: QUOTE_INCLUDE });
    if (!quote) throw new NotFoundException('Cotización no encontrada');
    return quote;
  }

  /** Marca como EXPIRED las cotizaciones vencidas aún abiertas (perezoso). */
  private async expireStale(tenantId: string) {
    await this.prisma.quote.updateMany({
      where: {
        tenantId,
        validUntil: { lt: new Date() },
        status: { in: [QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.ACCEPTED] },
      },
      data: { status: QuoteStatus.EXPIRED },
    });
  }

  async create(tenantId: string, userId: string, input: QuoteInput) {
    const { itemsData, total, itbis, subtotal } = await this.priceItems(tenantId, input.items);
    if (input.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId } });
      if (!c) throw new BadRequestException('Cliente inválido');
    }

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ n: number }[]>`
        UPDATE "Tenant" SET "quoteCounter" = "quoteCounter" + 1
        WHERE id = ${tenantId} RETURNING "quoteCounter" AS n`;
      const number = rows[0].n;
      return tx.quote.create({
        data: {
          tenantId,
          number,
          customerId: input.customerId || null,
          clientNameSnapshot: input.clientName?.trim() || null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          notes: input.notes?.trim() || null,
          status: QuoteStatus.DRAFT,
          createdById: userId,
          subtotal,
          itbis,
          total,
          items: { create: itemsData },
        },
        include: QUOTE_INCLUDE,
      });
    });
  }

  async update(tenantId: string, id: string, input: QuoteInput) {
    const quote = await this.get(tenantId, id);
    const editable: QuoteStatus[] = [QuoteStatus.DRAFT, QuoteStatus.SENT];
    if (!editable.includes(quote.status)) {
      throw new BadRequestException('Solo se pueden editar cotizaciones en borrador o enviadas');
    }
    const { itemsData, total, itbis, subtotal } = await this.priceItems(tenantId, input.items);
    return this.prisma.$transaction(async (tx) => {
      await tx.quoteItem.deleteMany({ where: { quoteId: id } });
      return tx.quote.update({
        where: { id },
        data: {
          customerId: input.customerId !== undefined ? input.customerId || null : undefined,
          clientNameSnapshot: input.clientName?.trim() || null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          notes: input.notes?.trim() || null,
          subtotal,
          itbis,
          total,
          items: { create: itemsData },
        },
        include: QUOTE_INCLUDE,
      });
    });
  }

  async setStatus(tenantId: string, id: string, status: QuoteStatus) {
    const quote = await this.get(tenantId, id);
    if (quote.status === QuoteStatus.CONVERTED) {
      throw new BadRequestException('Una cotización convertida no puede cambiar de estado');
    }
    const allowed: QuoteStatus[] = [QuoteStatus.DRAFT, QuoteStatus.SENT, QuoteStatus.ACCEPTED, QuoteStatus.CANCELLED];
    if (!allowed.includes(status)) throw new BadRequestException('Estado inválido');
    return this.prisma.quote.update({ where: { id }, data: { status }, include: QUOTE_INCLUDE });
  }

  /**
   * Convierte la cotización en un pedido (Order) pendiente de cobro. Funciona en
   * ambos modos: el pedido se cobra en caja (BILLER_CASHIER) o se carga en el POS
   * (DIRECT). Marca la cotización CONVERTED de forma atómica — no se puede repetir.
   */
  async convert(tenantId: string, id: string, userId: string) {
    const quote = await this.get(tenantId, id);
    if (quote.status === QuoteStatus.CONVERTED) {
      throw new BadRequestException('La cotización ya fue convertida');
    }
    if (quote.status === QuoteStatus.CANCELLED || quote.status === QuoteStatus.EXPIRED) {
      throw new BadRequestException('La cotización está cancelada o vencida');
    }
    if (quote.validUntil && quote.validUntil < new Date()) {
      await this.prisma.quote.update({ where: { id }, data: { status: QuoteStatus.EXPIRED } });
      throw new BadRequestException('La cotización está vencida');
    }

    const clientName =
      quote.customer?.name ?? quote.clientNameSnapshot ?? undefined;
    const clientRnc =
      quote.customer?.docType === 'RNC' ? quote.customer.docNumber ?? undefined : undefined;

    const order = await this.ordersService.create(tenantId, userId, {
      items: quote.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        isLoose: i.isLoose,
      })),
      clientName,
      clientRnc,
      notes: `Desde cotización #${quote.number}`,
    });

    const updated = await this.prisma.quote.update({
      where: { id },
      data: { status: QuoteStatus.CONVERTED, convertedOrderId: order.id },
      include: QUOTE_INCLUDE,
    });
    return { quote: updated, order };
  }
}
