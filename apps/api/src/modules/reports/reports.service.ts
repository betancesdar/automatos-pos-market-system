import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod } from '@prisma/client';
import { buildSpreadsheet } from '../../common/spreadsheet.util';

export type ReportDimension =
  | 'product' | 'category' | 'zone' | 'payment' | 'ncfType' | 'cashier' | 'day';

export interface DetailedReportFilters {
  from?: string;
  to?: string;
  groupBy?: ReportDimension;
  categoryId?: string;
  zoneId?: string;
  paymentMethod?: string;
  cashierId?: string;
}

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', CREDIT: 'Crédito',
};
const NCF_LABEL: Record<string, string> = {
  VENTA_RAPIDA: 'Venta rápida', CONSUMIDOR_FINAL: 'Consumidor final (B02/e-CF 32)',
  CREDITO_FISCAL: 'Crédito fiscal (B01/e-CF 31)', GUBERNAMENTAL: 'Gubernamental (B15/e-CF 45)',
  REGISTRO_UNICO_INGRESO: 'Registro único de ingreso', SIN_NCF: 'Sin NCF',
};

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) return undefined;
    return {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: endOfDayIfDateOnly(to) }),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reports/detailed — constructor de reportes complejos (agrupar + filtrar)
  // ──────────────────────────────────────────────────────────────────────────
  async getDetailedReport(tenantId: string, f: DetailedReportFilters) {
    const groupBy: ReportDimension = f.groupBy ?? 'product';
    const createdAt = this.buildDateFilter(f.from, f.to);

    const items = await this.prisma.saleItem.findMany({
      where: {
        sale: {
          tenantId,
          status: { not: 'VOIDED' },
          ...(createdAt && { createdAt }),
          ...(f.paymentMethod ? { paymentMethod: f.paymentMethod as PaymentMethod } : {}),
          ...(f.cashierId ? { cashSession: { userId: f.cashierId } } : {}),
        },
        ...(f.categoryId ? { product: { categoryId: f.categoryId } } : {}),
        ...(f.zoneId ? { product: { zoneId: f.zoneId === 'NONE' ? null : f.zoneId } } : {}),
      },
      include: {
        product: { select: { name: true, category: { select: { name: true } }, zone: { select: { name: true } } } },
        sale: {
          select: {
            id: true, paymentMethod: true, ncfType: true, createdAt: true,
            cashSession: { select: { user: { select: { name: true } } } },
          },
        },
      },
    });

    const keyOf = (it: (typeof items)[number]): { key: string; label: string } => {
      switch (groupBy) {
        case 'category': return { key: it.product.category?.name ?? 'Sin categoría', label: it.product.category?.name ?? 'Sin categoría' };
        case 'zone': return { key: it.product.zone?.name ?? 'Sin zona', label: it.product.zone?.name ?? 'Sin zona' };
        case 'payment': return { key: it.sale.paymentMethod, label: PAYMENT_LABEL[it.sale.paymentMethod] ?? it.sale.paymentMethod };
        case 'ncfType': return { key: it.sale.ncfType, label: NCF_LABEL[it.sale.ncfType] ?? it.sale.ncfType };
        case 'cashier': return { key: it.sale.cashSession?.user?.name ?? 'Sin caja', label: it.sale.cashSession?.user?.name ?? 'Sin caja' };
        case 'day': { const d = it.sale.createdAt.toISOString().slice(0, 10); return { key: d, label: d }; }
        default: return { key: it.product.name, label: it.product.name };
      }
    };

    const groups = new Map<string, { label: string; qty: number; revenue: number; cost: number; saleIds: Set<string> }>();
    for (const it of items) {
      const { key, label } = keyOf(it);
      const g = groups.get(key) ?? { label, qty: 0, revenue: 0, cost: 0, saleIds: new Set<string>() };
      g.qty += it.quantity;
      g.revenue += it.price * it.quantity;
      g.cost += (it.cost || 0) * it.quantity;
      g.saleIds.add(it.sale.id);
      groups.set(key, g);
    }

    let rows = Array.from(groups.values()).map((g) => {
      const revenue = round(g.revenue);
      const cost = round(g.cost);
      const profit = round(revenue - cost);
      return {
        label: g.label,
        qty: round(g.qty),
        salesCount: g.saleIds.size,
        revenue, cost, profit,
        marginPct: revenue > 0 ? round((profit / revenue) * 100) : 0,
      };
    });
    rows = groupBy === 'day'
      ? rows.sort((a, b) => a.label.localeCompare(b.label))
      : rows.sort((a, b) => b.revenue - a.revenue);

    const totals = rows.reduce(
      (t, r) => ({
        qty: round(t.qty + r.qty),
        salesCount: t.salesCount, // (ver abajo: conteo de ventas distintas global)
        revenue: round(t.revenue + r.revenue),
        cost: round(t.cost + r.cost),
        profit: round(t.profit + r.profit),
      }),
      { qty: 0, salesCount: 0, revenue: 0, cost: 0, profit: 0 },
    );
    const distinctSales = new Set(items.map((it) => it.sale.id));
    totals.salesCount = distinctSales.size;

    return {
      groupBy,
      period: { from: f.from || 'all-time', to: f.to || 'now' },
      rows,
      totals: { ...totals, marginPct: totals.revenue > 0 ? round((totals.profit / totals.revenue) * 100) : 0 },
    };
  }

  async exportDetailedReport(tenantId: string, f: DetailedReportFilters, format: 'csv' | 'xlsx'): Promise<Buffer> {
    const report = await this.getDetailedReport(tenantId, f);
    const dimHeader: Record<ReportDimension, string> = {
      product: 'Producto', category: 'Categoría', zone: 'Zona', payment: 'Forma de pago',
      ncfType: 'Tipo de comprobante', cashier: 'Cajero', day: 'Día',
    };
    const columns = [
      { header: dimHeader[report.groupBy], key: 'label', width: 34 },
      { header: 'Cantidad', key: 'qty', width: 12 },
      { header: 'Ventas', key: 'salesCount', width: 10 },
      { header: 'Ingreso', key: 'revenue', width: 14 },
      { header: 'Costo', key: 'cost', width: 14 },
      { header: 'Ganancia', key: 'profit', width: 14 },
      { header: 'Margen %', key: 'marginPct', width: 10 },
    ];
    return buildSpreadsheet(format, 'Reporte', columns, report.rows as unknown as Record<string, unknown>[]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reports/sales — KPIs + payment method breakdown for a date range
  // ──────────────────────────────────────────────────────────────────────────
  async getSalesReport(tenantId: string, from?: string, to?: string) {
    const createdAt = this.buildDateFilter(from, to);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId, status: { not: 'VOIDED' }, ...(createdAt && { createdAt }) },
      include: { items: true },
    });

    let grossSales = 0;
    let totalDiscount = 0;
    let itbisCollected = 0;
    let totalCost = 0;

    const byPaymentMethod: Record<PaymentMethod, { method: PaymentMethod; count: number; total: number }> = {
      CASH: { method: PaymentMethod.CASH, count: 0, total: 0 },
      CARD: { method: PaymentMethod.CARD, count: 0, total: 0 },
      TRANSFER: { method: PaymentMethod.TRANSFER, count: 0, total: 0 },
      CREDIT: { method: PaymentMethod.CREDIT, count: 0, total: 0 },
    };

    for (const sale of sales) {
      grossSales += sale.subtotal;
      itbisCollected += sale.itbis;
      totalDiscount += Math.max(0, sale.subtotal - sale.total);
      for (const item of sale.items) {
        totalCost += item.cost * item.quantity;
      }
      byPaymentMethod[sale.paymentMethod].count += 1;
      byPaymentMethod[sale.paymentMethod].total += sale.total;
    }

    const netSales = sales.reduce((s, sale) => s + sale.total, 0);
    grossSales = parseFloat(grossSales.toFixed(2));

    // Net profit = net sales (post-discount, tax-exclusive line totals) minus
    // the cost of goods sold. Margin is expressed as a % of net sales, with
    // a safe fallback when there are no sales in the selected period.
    const grossProfit = parseFloat((netSales - totalCost).toFixed(2));
    const profitMargin = netSales > 0 ? parseFloat(((grossProfit / netSales) * 100).toFixed(2)) : 0;

    return {
      period: { from: from || 'all-time', to: to || 'now' },
      totalSales: sales.length,
      grossSales,
      netSales: parseFloat(netSales.toFixed(2)),
      itbisCollected: parseFloat(itbisCollected.toFixed(2)),
      totalDiscount: parseFloat(totalDiscount.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      // `grossProfit` is the canonical field going forward; `netProfit` is
      // kept as an alias so any existing consumers of this endpoint keep working.
      grossProfit,
      netProfit: grossProfit,
      profitMargin,
      byPaymentMethod: Object.values(byPaymentMethod).map((p) => ({
        ...p,
        total: parseFloat(p.total.toFixed(2)),
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GET /reports/top-products — best sellers within a date range
  // ──────────────────────────────────────────────────────────────────────────
  async getTopProducts(tenantId: string, from?: string, to?: string, limit = 10) {
    const createdAt = this.buildDateFilter(from, to);

    const saleItems = await this.prisma.saleItem.findMany({
      where: { sale: { tenantId, status: { not: 'VOIDED' }, ...(createdAt && { createdAt }) } },
      include: { product: { select: { id: true, name: true, imageUrl: true } } },
    });

    const map = new Map<
      string,
      { productId: string; name: string; imageUrl: string | null; qty: number; revenue: number; cost: number }
    >();
    for (const item of saleItems) {
      const existing = map.get(item.productId) ?? {
        productId: item.productId,
        name: item.product.name,
        imageUrl: item.product.imageUrl,
        qty: 0,
        revenue: 0,
        cost: 0,
      };
      existing.qty += item.quantity;
      existing.revenue += item.price * item.quantity;
      // `SaleItem.cost` is the unit cost snapshotted at sale time — fall back
      // to the current product cost if a legacy row ever has it unset (0/null).
      existing.cost += (item.cost || 0) * item.quantity;
      map.set(item.productId, existing);
    }

    return Array.from(map.values())
      .map((p) => {
        const revenue = parseFloat(p.revenue.toFixed(2));
        const cost = parseFloat(p.cost.toFixed(2));
        const profit = parseFloat((revenue - cost).toFixed(2));
        const marginPct = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0;
        return { ...p, revenue, cost, profit, marginPct, qty: parseFloat(p.qty.toFixed(2)) };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }
}

function round(n: number): number {
  return parseFloat((n || 0).toFixed(2));
}

/** Si `to` viene como fecha sin hora (YYYY-MM-DD), extiende al fin del día. */
function endOfDayIfDateOnly(to: string): Date {
  const d = new Date(to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) d.setHours(23, 59, 59, 999);
  return d;
}
