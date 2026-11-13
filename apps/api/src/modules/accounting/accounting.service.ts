import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditActor } from '../../common/audit.module';
import { PaymentMethod, Prisma } from '@prisma/client';

/** DGII expense classification codes for Formato 606. */
export const DGII_EXPENSE_CATEGORIES: Record<string, string> = {
  '01': 'Gastos de personal',
  '02': 'Gastos por trabajos, suministros y servicios',
  '03': 'Arrendamientos',
  '04': 'Gastos de activos fijos',
  '05': 'Gastos de representación',
  '06': 'Otras deducciones admitidas',
  '07': 'Gastos financieros',
  '08': 'Gastos extraordinarios',
  '09': 'Compras y gastos que forman parte del costo de venta',
  '10': 'Adquisiciones de activos',
  '11': 'Gastos de seguros',
};

interface PurchaseInput {
  supplierRnc: string;
  supplierName: string;
  ncf: string;
  ncfType?: string;
  expenseCategory: string;
  date: string;
  subtotal: number;
  itbis?: number;
  itbisRetenido?: number;
  isrRetenido?: number;
  total: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from, to };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, ''); // AAAAMMDD
}

@Injectable()
export class AccountingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ───────────────────── Conciliación de cajas ─────────────────────

  async listReconciliations(
    tenantId: string,
    filters: { from?: string; to?: string; status?: string },
  ) {
    const where: Prisma.CashReconciliationWhereInput = { tenantId };
    if (filters.status && filters.status !== 'ALL') where.status = filters.status;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) {
        const end = new Date(filters.to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    return this.prisma.cashReconciliation.findMany({
      where,
      include: {
        cashSession: {
          select: {
            openedAt: true,
            closedAt: true,
            openingBalance: true,
            user: { select: { name: true, username: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async reviewReconciliation(
    tenantId: string,
    id: string,
    actor: AuditActor,
    data: { status: 'APPROVED' | 'OBSERVED'; reviewNotes?: string },
  ) {
    if (!['APPROVED', 'OBSERVED'].includes(data.status)) {
      throw new BadRequestException('status debe ser APPROVED u OBSERVED');
    }
    const rec = await this.prisma.cashReconciliation.findFirst({ where: { id, tenantId } });
    if (!rec) throw new NotFoundException('Conciliación no encontrada');

    const updated = await this.prisma.cashReconciliation.update({
      where: { id },
      data: {
        status: data.status,
        reviewNotes: data.reviewNotes?.trim() || null,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
      },
    });
    this.audit.log(actor, `RECONCILIATION_${data.status}`, tenantId, {
      reconciliationId: id,
      difference: rec.difference,
      notes: data.reviewNotes,
    });
    return updated;
  }

  // ───────────────────── Compras / gastos (606) ─────────────────────

  async listPurchases(tenantId: string, filters: { year?: number; month?: number }) {
    const where: Prisma.PurchaseWhereInput = { tenantId };
    if (filters.year && filters.month) {
      const { from, to } = monthRange(filters.year, filters.month);
      where.date = { gte: from, lt: to };
    }
    return this.prisma.purchase.findMany({ where, orderBy: { date: 'desc' }, take: 500 });
  }

  async createPurchase(tenantId: string, createdById: string, data: PurchaseInput) {
    this.validatePurchase(data);
    return this.prisma.purchase.create({
      data: {
        tenantId,
        createdById,
        supplierRnc: data.supplierRnc.replace(/\D/g, ''),
        supplierName: data.supplierName.trim(),
        ncf: data.ncf.trim().toUpperCase(),
        ncfType: data.ncfType ?? 'B01',
        expenseCategory: data.expenseCategory,
        date: new Date(data.date),
        subtotal: data.subtotal,
        itbis: data.itbis ?? 0,
        itbisRetenido: data.itbisRetenido ?? 0,
        isrRetenido: data.isrRetenido ?? 0,
        total: data.total,
        paymentMethod: data.paymentMethod ?? PaymentMethod.CASH,
        notes: data.notes?.trim() || null,
      },
    });
  }

  async updatePurchase(tenantId: string, id: string, data: Partial<PurchaseInput>) {
    const purchase = await this.prisma.purchase.findFirst({ where: { id, tenantId } });
    if (!purchase) throw new NotFoundException('Compra no encontrada');
    await this.assertPeriodOpen(tenantId, purchase.date);
    return this.prisma.purchase.update({
      where: { id },
      data: {
        supplierRnc: data.supplierRnc ? data.supplierRnc.replace(/\D/g, '') : undefined,
        supplierName: data.supplierName?.trim(),
        ncf: data.ncf?.trim().toUpperCase(),
        ncfType: data.ncfType,
        expenseCategory: data.expenseCategory,
        date: data.date ? new Date(data.date) : undefined,
        subtotal: data.subtotal,
        itbis: data.itbis,
        itbisRetenido: data.itbisRetenido,
        isrRetenido: data.isrRetenido,
        total: data.total,
        paymentMethod: data.paymentMethod,
        notes: data.notes !== undefined ? data.notes?.trim() || null : undefined,
      },
    });
  }

  async deletePurchase(tenantId: string, id: string) {
    const purchase = await this.prisma.purchase.findFirst({ where: { id, tenantId } });
    if (!purchase) throw new NotFoundException('Compra no encontrada');
    await this.assertPeriodOpen(tenantId, purchase.date);
    return this.prisma.purchase.delete({ where: { id } });
  }

  private validatePurchase(data: PurchaseInput) {
    const rnc = data.supplierRnc?.replace(/\D/g, '') ?? '';
    if (rnc.length !== 9 && rnc.length !== 11) {
      throw new BadRequestException('RNC del proveedor debe tener 9 u 11 dígitos');
    }
    if (!data.supplierName?.trim()) throw new BadRequestException('Nombre del proveedor requerido');
    if (!data.ncf?.trim()) throw new BadRequestException('NCF del proveedor requerido');
    if (!DGII_EXPENSE_CATEGORIES[data.expenseCategory]) {
      throw new BadRequestException('Categoría de gasto DGII inválida (01-11)');
    }
    if (!data.date || isNaN(new Date(data.date).getTime())) {
      throw new BadRequestException('Fecha inválida');
    }
    if (typeof data.total !== 'number' || data.total <= 0) {
      throw new BadRequestException('Total debe ser mayor a 0');
    }
  }

  private async assertPeriodOpen(tenantId: string, date: Date) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: {
        tenantId_year_month: {
          tenantId,
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
        },
      },
    });
    if (period && period.status !== 'OPEN') {
      throw new ConflictException(
        `El período ${period.year}-${String(period.month).padStart(2, '0')} está cerrado — no se puede modificar`,
      );
    }
  }

  // ───────────────────── Asientos / movimientos manuales ─────────────────────

  async listEntries(tenantId: string, filters: { year?: number; month?: number }) {
    const where: Prisma.AccountingEntryWhereInput = { tenantId };
    if (filters.year && filters.month) {
      const { from, to } = monthRange(filters.year, filters.month);
      where.date = { gte: from, lt: to };
    }
    return this.prisma.accountingEntry.findMany({ where, orderBy: { date: 'desc' }, take: 300 });
  }

  async createEntry(
    tenantId: string,
    createdById: string,
    data: { date: string; type: 'INCOME' | 'EXPENSE' | 'ADJUSTMENT'; category: string; amount: number; description?: string },
  ) {
    if (!data.date) throw new BadRequestException('La fecha es obligatoria');
    if (!data.category?.trim()) throw new BadRequestException('La categoría es obligatoria');
    if (!data.amount || data.amount <= 0) throw new BadRequestException('El monto debe ser mayor que cero');
    const date = new Date(data.date);
    await this.assertPeriodOpen(tenantId, date);
    return this.prisma.accountingEntry.create({
      data: {
        tenantId,
        date,
        type: data.type,
        category: data.category.trim(),
        amount: new Prisma.Decimal(data.amount),
        description: data.description?.trim() || null,
        createdById,
      },
    });
  }

  async deleteEntry(tenantId: string, id: string) {
    const entry = await this.prisma.accountingEntry.findFirst({ where: { id, tenantId } });
    if (!entry) throw new NotFoundException('Movimiento no encontrado');
    await this.assertPeriodOpen(tenantId, entry.date);
    await this.prisma.accountingEntry.delete({ where: { id } });
    return { deleted: true };
  }

  /** Drill-down: transacciones que componen una cifra del mes. */
  async transactions(tenantId: string, year: number, month: number, kind: string) {
    const { from, to } = monthRange(year, month);
    if (kind === 'sales') {
      const sales = await this.prisma.sale.findMany({
        where: { tenantId, status: { not: 'VOIDED' }, createdAt: { gte: from, lt: to } },
        select: { id: true, invoiceNumber: true, ncf: true, total: true, itbis: true, paymentMethod: true, clientName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      return { kind, rows: sales };
    }
    if (kind === 'purchases') {
      const rows = await this.prisma.purchase.findMany({
        where: { tenantId, date: { gte: from, lt: to } },
        orderBy: { date: 'desc' },
      });
      return { kind, rows };
    }
    if (kind === 'credit-payments') {
      const rows = await this.prisma.creditPayment.findMany({
        where: { tenantId, createdAt: { gte: from, lt: to } },
        select: { id: true, amount: true, method: true, isDownPayment: true, createdAt: true, creditSale: { select: { customer: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      return { kind, rows };
    }
    if (kind === 'entries') {
      const rows = await this.prisma.accountingEntry.findMany({
        where: { tenantId, date: { gte: from, lt: to } },
        orderBy: { date: 'desc' },
      });
      return { kind, rows };
    }
    throw new BadRequestException('Tipo de transacción inválido');
  }

  // ───────────────────── Reportes DGII ─────────────────────

  /** Formato 606 (compras) — filas + TXT pipe-delimited para carga en DGII. */
  async report606(tenantId: string, year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const purchases = await this.prisma.purchase.findMany({
      where: { tenantId, date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    });

    const rows = purchases.map((p) => ({
      rncCedula: p.supplierRnc,
      tipoId: p.supplierRnc.length === 9 ? '1' : '2',
      tipoBienServicio: p.expenseCategory,
      ncf: p.ncf,
      fecha: fmtDate(p.date),
      montoFacturado: parseFloat((p.total - p.itbis).toFixed(2)),
      itbisFacturado: p.itbis,
      itbisRetenido: p.itbisRetenido,
      isrRetenido: p.isrRetenido,
      total: p.total,
      proveedor: p.supplierName,
    }));

    const txt = rows
      .map((r) =>
        [
          r.rncCedula,
          r.tipoId,
          r.tipoBienServicio,
          r.ncf,
          '', // NCF modificado
          r.fecha,
          '', // fecha pago
          r.montoFacturado.toFixed(2),
          r.itbisFacturado.toFixed(2),
          r.itbisRetenido.toFixed(2),
          r.isrRetenido.toFixed(2),
        ].join('|'),
      )
      .join('\n');

    return {
      period: `${year}${String(month).padStart(2, '0')}`,
      count: rows.length,
      totals: {
        montoFacturado: sum(rows.map((r) => r.montoFacturado)),
        itbis: sum(rows.map((r) => r.itbisFacturado)),
        itbisRetenido: sum(rows.map((r) => r.itbisRetenido)),
        isrRetenido: sum(rows.map((r) => r.isrRetenido)),
      },
      rows,
      txt,
    };
  }

  /** Formato 607 (ventas) — ventas COMPLETED del mes con NCF. */
  async report607(tenantId: string, year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const sales = await this.prisma.sale.findMany({
      where: { tenantId, status: 'COMPLETED', createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'asc' },
      select: {
        invoiceNumber: true,
        ncf: true,
        clientRnc: true,
        clientName: true,
        total: true,
        itbis: true,
        paymentMethod: true,
        createdAt: true,
      },
    });

    const rows = sales
      .filter((s) => s.ncf) // el 607 reporta comprobantes fiscales emitidos
      .map((s) => ({
        rncCedula: s.clientRnc ?? '',
        tipoId: s.clientRnc ? (s.clientRnc.length === 9 ? '1' : '2') : '3',
        ncf: s.ncf!,
        tipoIngreso: '01', // ingresos por operaciones
        fecha: fmtDate(s.createdAt),
        montoFacturado: parseFloat((s.total - s.itbis).toFixed(2)),
        itbisFacturado: s.itbis,
        efectivo: s.paymentMethod === 'CASH' ? s.total : 0,
        tarjeta: s.paymentMethod === 'CARD' ? s.total : 0,
        transferencia: s.paymentMethod === 'TRANSFER' ? s.total : 0,
        total: s.total,
        cliente: s.clientName ?? '',
        factura: s.invoiceNumber,
      }));

    const txt = rows
      .map((r) =>
        [
          r.rncCedula,
          r.tipoId,
          r.ncf,
          '', // NCF modificado
          r.tipoIngreso,
          r.fecha,
          r.montoFacturado.toFixed(2),
          r.itbisFacturado.toFixed(2),
          r.efectivo.toFixed(2),
          r.tarjeta.toFixed(2),
          r.transferencia.toFixed(2),
        ].join('|'),
      )
      .join('\n');

    return {
      period: `${year}${String(month).padStart(2, '0')}`,
      count: rows.length,
      salesWithoutNcf: sales.length - rows.length,
      totals: {
        montoFacturado: sum(rows.map((r) => r.montoFacturado)),
        itbis: sum(rows.map((r) => r.itbisFacturado)),
        total: sum(rows.map((r) => r.total)),
      },
      rows,
      txt,
    };
  }

  /** Formato 608 (NCF anulados). */
  async report608(tenantId: string, year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const voided = await this.prisma.sale.findMany({
      where: {
        tenantId,
        status: 'VOIDED',
        ncf: { not: null },
        voidedAt: { gte: from, lt: to },
      },
      orderBy: { voidedAt: 'asc' },
      select: { ncf: true, voidedAt: true, voidReason: true, invoiceNumber: true, total: true },
    });

    const rows = voided.map((s) => ({
      ncf: s.ncf!,
      fecha: fmtDate(s.voidedAt!),
      // Tipo de anulación DGII: 02 = errores de impresión / 04 = corrección de
      // la información — se usa 02 por defecto; el contable puede ajustarlo.
      tipoAnulacion: '02',
      motivo: s.voidReason ?? '',
      factura: s.invoiceNumber,
      total: s.total,
    }));

    const txt = rows.map((r) => [r.ncf, r.fecha, r.tipoAnulacion].join('|')).join('\n');

    return {
      period: `${year}${String(month).padStart(2, '0')}`,
      count: rows.length,
      rows,
      txt,
    };
  }

  /** Pre-cálculo IT-1: ITBIS cobrado − ITBIS adelantado en compras. */
  async itbisSummary(tenantId: string, year: number, month: number) {
    const { from, to } = monthRange(year, month);
    const [salesAgg, purchasesAgg] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { tenantId, status: 'COMPLETED', createdAt: { gte: from, lt: to } },
        _sum: { itbis: true, total: true },
        _count: true,
      }),
      this.prisma.purchase.aggregate({
        where: { tenantId, date: { gte: from, lt: to } },
        _sum: { itbis: true, itbisRetenido: true, total: true },
        _count: true,
      }),
    ]);

    const itbisCobrado = salesAgg._sum.itbis ?? 0;
    const itbisAdelantado = purchasesAgg._sum.itbis ?? 0;
    const balance = parseFloat((itbisCobrado - itbisAdelantado).toFixed(2));

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      ventas: {
        count: salesAgg._count,
        total: salesAgg._sum.total ?? 0,
        itbisCobrado,
      },
      compras: {
        count: purchasesAgg._count,
        total: purchasesAgg._sum.total ?? 0,
        itbisAdelantado,
        itbisRetenido: purchasesAgg._sum.itbisRetenido ?? 0,
      },
      balance,
      aPagar: balance > 0 ? balance : 0,
      aFavor: balance < 0 ? Math.abs(balance) : 0,
    };
  }

  // ───────────────────── Cierre mensual ─────────────────────

  async listPeriods(tenantId: string) {
    return this.prisma.accountingPeriod.findMany({
      where: { tenantId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 24,
    });
  }

  async closePeriod(tenantId: string, year: number, month: number, actor: AuditActor) {
    const { from, to } = monthRange(year, month);

    const existing = await this.prisma.accountingPeriod.findUnique({
      where: { tenantId_year_month: { tenantId, year, month } },
    });
    if (existing && existing.status !== 'OPEN') {
      throw new ConflictException('Este período ya está cerrado');
    }

    // Checklist: every reconciliation of the month must be reviewed.
    const pendingRecs = await this.prisma.cashReconciliation.count({
      where: { tenantId, status: 'PENDING_REVIEW', createdAt: { gte: from, lt: to } },
    });
    if (pendingRecs > 0) {
      throw new BadRequestException(
        `Hay ${pendingRecs} conciliación(es) de caja pendientes de revisión en este mes. Revísalas antes de cerrar.`,
      );
    }

    const [itbis, r607, r608, diffAgg] = await Promise.all([
      this.itbisSummary(tenantId, year, month),
      this.report607(tenantId, year, month),
      this.report608(tenantId, year, month),
      this.prisma.cashReconciliation.aggregate({
        where: { tenantId, createdAt: { gte: from, lt: to } },
        _sum: { difference: true },
      }),
    ]);

    const snapshot = {
      ventas: itbis.ventas,
      compras: itbis.compras,
      itbisBalance: itbis.balance,
      comprobantesEmitidos: r607.count,
      ventasSinNcf: r607.salesWithoutNcf,
      ncfAnulados: r608.count,
      diferenciaCajas: diffAgg._sum.difference ?? 0,
      closedAt: new Date().toISOString(),
    };

    const period = await this.prisma.accountingPeriod.upsert({
      where: { tenantId_year_month: { tenantId, year, month } },
      create: {
        tenantId,
        year,
        month,
        status: 'CLOSED',
        snapshot,
        closedById: actor.sub,
        closedAt: new Date(),
      },
      update: {
        status: 'CLOSED',
        snapshot,
        closedById: actor.sub,
        closedAt: new Date(),
      },
    });
    this.audit.log(actor, 'PERIOD_CLOSE', tenantId, { year, month });
    return period;
  }

  async approvePeriod(tenantId: string, year: number, month: number, actor: AuditActor) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { tenantId_year_month: { tenantId, year, month } },
    });
    if (!period) throw new NotFoundException('Período no encontrado — ciérralo primero');
    if (period.status === 'APPROVED') throw new ConflictException('Período ya aprobado');
    if (period.status !== 'CLOSED') {
      throw new BadRequestException('El período debe cerrarse antes de aprobarse');
    }

    const updated = await this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: { status: 'APPROVED', approvedById: actor.sub, approvedAt: new Date() },
    });
    this.audit.log(actor, 'PERIOD_APPROVE', tenantId, { year, month });
    return updated;
  }

  async reopenPeriod(tenantId: string, year: number, month: number, actor: AuditActor) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { tenantId_year_month: { tenantId, year, month } },
    });
    if (!period) throw new NotFoundException('Período no encontrado');
    const updated = await this.prisma.accountingPeriod.update({
      where: { id: period.id },
      data: { status: 'OPEN', approvedById: null, approvedAt: null },
    });
    this.audit.log(actor, 'PERIOD_REOPEN', tenantId, { year, month });
    return updated;
  }

  // ───────────────────── Dashboard contable ─────────────────────

  async dashboard(tenantId: string) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const { from, to } = monthRange(year, month);

    const [itbis, pendingRecs, failedEcf, period, cartera, cobradoMes, entriesAgg] = await Promise.all([
      this.itbisSummary(tenantId, year, month),
      this.prisma.cashReconciliation.count({
        where: { tenantId, status: 'PENDING_REVIEW' },
      }),
      this.prisma.ecfSubmission.count({
        where: { tenantId, status: 'FAILED' },
      }),
      this.prisma.accountingPeriod.findUnique({
        where: { tenantId_year_month: { tenantId, year, month } },
      }),
      this.prisma.creditSale.aggregate({
        where: { tenantId, status: { in: ['OPEN', 'OVERDUE'] } },
        _sum: { balance: true },
      }),
      this.prisma.creditPayment.aggregate({
        where: { tenantId, createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
      this.prisma.accountingEntry.groupBy({
        by: ['type'],
        where: { tenantId, date: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    ]);

    const entriesByType: Record<string, number> = {};
    for (const e of entriesAgg) entriesByType[e.type] = Number(e._sum.amount ?? 0);

    const salesWithoutNcf = await this.prisma.sale.count({
      where: {
        tenantId,
        status: 'COMPLETED',
        ncf: null,
        ncfType: { in: ['CONSUMIDOR_FINAL', 'CREDITO_FISCAL', 'GUBERNAMENTAL', 'REGISTRO_UNICO_INGRESO'] },
        createdAt: { gte: from, lt: to },
      },
    });

    return {
      ...itbis,
      cartera: {
        porCobrar: Number(cartera._sum.balance ?? 0),
        cobradoMes: Number(cobradoMes._sum.amount ?? 0),
      },
      movimientosManuales: {
        ingresos: entriesByType.INCOME ?? 0,
        gastos: entriesByType.EXPENSE ?? 0,
        ajustes: entriesByType.ADJUSTMENT ?? 0,
      },
      alertas: {
        conciliacionesPendientes: pendingRecs,
        ecfFallidos: failedEcf,
        ventasFiscalesSinNcf: salesWithoutNcf,
      },
      periodoActual: period?.status ?? 'OPEN',
      categoriasGasto: DGII_EXPENSE_CATEGORIES,
    };
  }
}

function sum(nums: number[]): number {
  return parseFloat(nums.reduce((a, b) => a + b, 0).toFixed(2));
}
