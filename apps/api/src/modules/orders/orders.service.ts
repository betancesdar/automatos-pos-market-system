import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { NcfType, OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { rdBusinessDate } from '../../common/business-date.util';
import {
  CreateOrderDto,
  UpdateOrderDto,
  OrderCheckoutDto,
  OrderItemDto,
} from './dto/order.dtos';

const ORDER_INCLUDE = {
  items: { include: { product: { select: { name: true, stock: true } } } },
  creator: { select: { id: true, name: true, username: true } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private salesService: SalesService,
  ) {}

  /**
   * Biller creates a pending order. Stock is validated informatively but NOT
   * reserved — the authoritative, atomic stock check happens at cashier
   * checkout (processSale). Pedido→cobro is a minutes-long cycle in a
   * minimarket, so reservations would add expiry complexity for little gain.
   */
  async create(tenantId: string, creatorUserId: string, data: CreateOrderDto) {
    const { itemsData, subtotal } = await this.validateAndPriceItems(
      tenantId,
      data.items,
    );

    const businessDate = rdBusinessDate();

    return this.prisma.$transaction(async (tx) => {
      // Atomic per-tenant/per-day short code (#001, #002, ...): single
      // statement upsert so two concurrent billers never share a code.
      const codeRows = await tx.$queryRaw<{ code: number }[]>`
        INSERT INTO "OrderDailyCounter" ("tenantId", "businessDate", "nextValue")
        VALUES (${tenantId}, ${businessDate}::date, 2)
        ON CONFLICT ("tenantId", "businessDate")
        DO UPDATE SET "nextValue" = "OrderDailyCounter"."nextValue" + 1
        RETURNING "nextValue" - 1 AS code`;
      const dailyCode = codeRows[0].code;

      return tx.order.create({
        data: {
          tenantId,
          dailyCode,
          businessDate,
          creatorUserId,
          clientName: data.clientName?.trim() || null,
          clientRnc: data.clientRnc?.replace(/\D/g, '') || null,
          ncfType: data.ncfType ?? NcfType.VENTA_RAPIDA,
          notes: data.notes?.trim() || null,
          subtotal,
          items: { create: itemsData },
        },
        include: ORDER_INCLUDE,
      });
    });
  }

  /** Cashier queue — lazily expires yesterday's pending orders first. */
  async list(tenantId: string, status?: string) {
    await this.expireStaleOrders(tenantId);

    const where: Prisma.OrderWhereInput = { tenantId };
    if (status && status !== 'ALL') {
      where.status = status as OrderStatus;
    }

    return this.prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  /** Looks up today's order by its short daily code (what the client was told). */
  async getByCode(tenantId: string, code: number) {
    await this.expireStaleOrders(tenantId);

    const order = await this.prisma.order.findUnique({
      where: {
        tenantId_businessDate_dailyCode: {
          tenantId,
          businessDate: rdBusinessDate(),
          dailyCode: code,
        },
      },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`No existe el pedido #${code} de hoy`);
    }
    return order;
  }

  /** Cashier adjusts a pending order before charging (e.g. stock ran out). */
  async update(tenantId: string, orderId: string, data: UpdateOrderDto) {
    const order = await this.getPendingOrder(tenantId, orderId);

    let itemsData: Awaited<ReturnType<typeof this.validateAndPriceItems>>['itemsData'] | undefined;
    let subtotal = order.subtotal;
    if (data.items) {
      const priced = await this.validateAndPriceItems(tenantId, data.items);
      itemsData = priced.itemsData;
      subtotal = priced.subtotal;
    }

    return this.prisma.$transaction(async (tx) => {
      if (itemsData) {
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      }
      return tx.order.update({
        where: { id: order.id },
        data: {
          clientName: data.clientName !== undefined ? data.clientName?.trim() || null : undefined,
          clientRnc: data.clientRnc !== undefined ? data.clientRnc?.replace(/\D/g, '') || null : undefined,
          ncfType: data.ncfType,
          notes: data.notes !== undefined ? data.notes?.trim() || null : undefined,
          subtotal,
          ...(itemsData ? { items: { create: itemsData } } : {}),
        },
        include: ORDER_INCLUDE,
      });
    });
  }

  /**
   * Cashier charges a pending order: claims it atomically (double-charge from
   * two registers is impossible — the second one gets a 409), then runs the
   * exact same `processSale` used by the classic POS checkout: atomic stock
   * decrement, invoice number, NCF, Sale row. If anything fails (e.g. stock
   * ran out between billing and charging) the whole transaction reverts and
   * the order remains PENDING so the cashier can adjust it.
   */
  async checkout(
    tenantId: string,
    orderId: string,
    cashierUserId: string,
    data: OrderCheckoutDto,
  ) {
    const openSession = await this.prisma.cashSession.findFirst({
      where: { tenantId, userId: cashierUserId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!openSession) {
      throw new BadRequestException(
        'No hay una caja abierta. Debes realizar la Apertura de Caja antes de cobrar.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent checkout can flip PENDING→COMPLETED.
      const claimed = await tx.order.updateMany({
        where: { id: orderId, tenantId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.COMPLETED, completedById: cashierUserId },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Este pedido ya fue cobrado, cancelado o expiró. Verifica en la lista de pendientes.',
        );
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      const { sale, receiptRaw } = await this.salesService.processSale(
        tx,
        tenantId,
        {
          items: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            isLoose: item.isLoose,
          })),
          cashReceived: data.cashReceived,
          ncfType: data.ncfType ?? order.ncfType,
          applyItbis: data.applyItbis,
          clientRnc: data.clientRnc ?? order.clientRnc ?? undefined,
          clientName: data.clientName ?? order.clientName ?? undefined,
          paymentMethod: data.paymentMethod ?? PaymentMethod.CASH,
          discountAmount: data.discountAmount,
        },
        { cashSessionId: openSession.id },
      );

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { saleId: sale.id },
        include: ORDER_INCLUDE,
      });

      return { sale, receiptRaw, order: updatedOrder };
    });

    // Post-commit, non-blocking e-CF emission (if the tenant has it enabled).
    this.salesService.enqueueEcfSafe(result.sale);

    return result;
  }

  async cancel(
    tenantId: string,
    orderId: string,
    user: { sub: string; role: string },
    reason?: string,
  ) {
    const order = await this.getPendingOrder(tenantId, orderId);

    // A biller may only cancel their own orders; cashier/admin can cancel any.
    if (user.role === 'BILLER' && order.creatorUserId !== user.sub) {
      throw new ForbiddenException('Solo puedes cancelar tus propios pedidos');
    }

    const result = await this.prisma.order.updateMany({
      where: { id: order.id, tenantId, status: OrderStatus.PENDING },
      data: {
        status: OrderStatus.CANCELLED,
        cancelReason: reason?.trim() || null,
      },
    });
    if (result.count === 0) {
      throw new ConflictException('El pedido ya no está pendiente');
    }
    return this.prisma.order.findUnique({ where: { id: order.id }, include: ORDER_INCLUDE });
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async getPendingOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException('El pedido ya no está pendiente');
    }
    return order;
  }

  /** Lazy end-of-day expiry: pending orders from previous business days. */
  private async expireStaleOrders(tenantId: string) {
    await this.prisma.order.updateMany({
      where: {
        tenantId,
        status: OrderStatus.PENDING,
        businessDate: { lt: rdBusinessDate() },
      },
      data: { status: OrderStatus.EXPIRED },
    });
  }

  private async validateAndPriceItems(tenantId: string, items: OrderItemDto[]) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const itemsData: {
      productId: string;
      quantity: number;
      unitPrice: number;
      isLoose: boolean;
    }[] = [];

    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Producto ${item.productId} no encontrado`);
      }
      const unitPrice = item.unitPrice ?? product.price;
      const isLoose = item.isLoose ?? unitPrice !== product.price;

      // Informational check only — no reservation. Authoritative check is the
      // atomic decrement at checkout.
      if (!isLoose && product.stock < Math.ceil(item.quantity)) {
        throw new BadRequestException(`Stock insuficiente para ${product.name}`);
      }

      subtotal += unitPrice * item.quantity;
      itemsData.push({
        productId: product.id,
        quantity: item.quantity,
        unitPrice,
        isLoose,
      });
    }

    return { itemsData, subtotal: parseFloat(subtotal.toFixed(2)) };
  }
}
