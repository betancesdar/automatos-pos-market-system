import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod } from '@prisma/client';
import { buildCashSessionCloseReceipt } from '../../common/escpos.util';

@Injectable()
export class CashSessionService {
  constructor(private prisma: PrismaService) {}

  /** Returns the currently OPEN cash session for this user, or null. */
  async getCurrent(tenantId: string, userId: string) {
    return this.prisma.cashSession.findFirst({
      where: { tenantId, userId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
  }

  /** Opens a new cash register session (Apertura de Caja). */
  async open(tenantId: string, userId: string, openingBalance: number) {
    if (openingBalance == null || openingBalance < 0) {
      throw new BadRequestException('El fondo inicial de caja debe ser un monto válido');
    }

    const existing = await this.getCurrent(tenantId, userId);
    if (existing) {
      throw new BadRequestException('Ya existe una caja abierta para este usuario');
    }

    return this.prisma.cashSession.create({
      data: {
        tenantId,
        userId,
        openingBalance: parseFloat(openingBalance.toFixed(2)),
        status: 'OPEN',
      },
    });
  }

  /**
   * Closes a cash register session (Cierre de Caja / blind count).
   * expectedClosingBalance = openingBalance + cash sales recorded during the session.
   * variance = actualClosingBalance - expectedClosingBalance
   */
  async close(tenantId: string, userId: string, sessionId: string, actualClosingBalance: number) {
    if (actualClosingBalance == null || actualClosingBalance < 0) {
      throw new BadRequestException('El monto contado debe ser un valor válido');
    }

    const session = await this.prisma.cashSession.findUnique({
      where: { id: sessionId },
      include: { user: true, tenant: true },
    });
    if (!session || session.tenantId !== tenantId) {
      throw new NotFoundException('Sesión de caja no encontrada');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('No puedes cerrar la caja de otro usuario');
    }
    if (session.status !== 'OPEN') {
      throw new BadRequestException('Esta caja ya fue cerrada');
    }

    const cashSalesSum = await this.prisma.sale.aggregate({
      where: { tenantId, cashSessionId: sessionId, paymentMethod: PaymentMethod.CASH },
      _sum: { total: true },
    });

    const cashSalesTotal = cashSalesSum._sum.total ?? 0;
    const expectedClosingBalance = parseFloat((session.openingBalance + cashSalesTotal).toFixed(2));
    const actual = parseFloat(actualClosingBalance.toFixed(2));
    const variance = parseFloat((actual - expectedClosingBalance).toFixed(2));

    const closedAt = new Date();
    const updated = await this.prisma.cashSession.update({
      where: { id: sessionId },
      data: {
        closedAt,
        expectedClosingBalance,
        actualClosingBalance: actual,
        status: 'CLOSED',
      },
    });

    const status = variance === 0 ? 'CAJA CUADRADA' : variance > 0 ? 'SOBRANTE' : 'FALTANTE';
    const receiptRaw = buildCashSessionCloseReceipt(
      session.tenant,
      {
        openedAt: session.openedAt,
        closedAt,
        openingBalance: session.openingBalance,
        expectedClosingBalance,
        actualClosingBalance: actual,
      },
      session.user.name,
    );

    return {
      ...updated,
      variance,
      status,
      cashSalesTotal: parseFloat(cashSalesTotal.toFixed(2)),
      receiptRaw,
    };
  }

  /** Lists cash session history for a tenant (most recent first). */
  async list(tenantId: string, limit = 30) {
    return this.prisma.cashSession.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }

  /** The most recent OPEN session for the tenant (any cashier). */
  private async getTenantOpenSession(tenantId: string) {
    return this.prisma.cashSession.findFirst({
      where: { tenantId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  /** Records an extra cash inflow or withdrawal on the tenant's open shift. */
  async addMovement(
    tenantId: string,
    data: { type: string; amount: number; reason: string; sessionId?: string },
  ) {
    const type = (data.type || '').toUpperCase();
    if (type !== 'INFLOW' && type !== 'OUTFLOW') {
      throw new BadRequestException('Tipo de movimiento inválido (INFLOW / OUTFLOW)');
    }
    if (data.amount == null || data.amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero');
    }
    if (!data.reason?.trim()) {
      throw new BadRequestException('Debe indicar el motivo del movimiento');
    }

    let session = data.sessionId
      ? await this.prisma.cashSession.findFirst({ where: { id: data.sessionId, tenantId } })
      : await this.getTenantOpenSession(tenantId);

    if (!session || session.status !== 'OPEN') {
      throw new BadRequestException('No hay una caja abierta para registrar el movimiento');
    }

    return this.prisma.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: session.id,
        type,
        amount: parseFloat(data.amount.toFixed(2)),
        reason: data.reason.trim(),
      },
    });
  }

  /** Full live breakdown for the tenant's currently open shift ("Turno en Curso"). */
  async getLiveShift(tenantId: string) {
    const session = await this.getTenantOpenSession(tenantId);
    if (!session) return null;

    const [completed, voided, movements] = await Promise.all([
      this.prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: { tenantId, cashSessionId: session.id, status: 'COMPLETED' },
        _sum: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          tenantId,
          cashSessionId: session.id,
          status: 'VOIDED',
          paymentMethod: PaymentMethod.CASH,
        },
        _sum: { total: true },
      }),
      this.prisma.cashMovement.findMany({
        where: { cashSessionId: session.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const sumBy = (method: PaymentMethod) =>
      completed.find((c) => c.paymentMethod === method)?._sum.total ?? 0;

    const cashSales = round(sumBy(PaymentMethod.CASH));
    const cardSales = round(sumBy(PaymentMethod.CARD));
    const transferSales = round(sumBy(PaymentMethod.TRANSFER));
    const cashRefunds = round(voided._sum.total ?? 0);
    const extraInflows = round(
      movements.filter((m) => m.type === 'INFLOW').reduce((s, m) => s + m.amount, 0),
    );
    const withdrawals = round(
      movements.filter((m) => m.type === 'OUTFLOW').reduce((s, m) => s + m.amount, 0),
    );

    const totalMovements = round(cashSales + extraInflows - withdrawals - cashRefunds);
    const expectedCash = round(
      session.openingBalance + cashSales + extraInflows - withdrawals - cashRefunds,
    );

    return {
      sessionId: session.id,
      cashier: session.user,
      openedAt: session.openedAt,
      openingBalance: round(session.openingBalance),
      cashSales,
      cardSales,
      transferSales,
      cashRefunds,
      extraInflows,
      withdrawals,
      totalMovements,
      expectedCash,
      movements,
    };
  }

  /** Aggregated income/expense summary for a date range (Shift Reports). */
  async getShiftSummary(tenantId: string, from?: string, to?: string) {
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    const hasRange = range.gte || range.lte;

    const movements = await this.prisma.cashMovement.findMany({
      where: { tenantId, ...(hasRange ? { createdAt: range } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { cashSession: { include: { user: { select: { name: true } } } } },
    });

    const periodIncome = round(
      movements.filter((m) => m.type === 'INFLOW').reduce((s, m) => s + m.amount, 0),
    );
    const periodExpenses = round(
      movements.filter((m) => m.type === 'OUTFLOW').reduce((s, m) => s + m.amount, 0),
    );
    const netDifference = round(periodIncome - periodExpenses);

    const sessions = await this.prisma.cashSession.findMany({
      where: { tenantId, ...(hasRange ? { openedAt: range } : {}) },
      include: { user: { select: { name: true } } },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });

    return { periodIncome, periodExpenses, netDifference, movements, sessions };
  }
}

function round(n: number): number {
  return parseFloat((n || 0).toFixed(2));
}
