import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentMethod } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) return undefined;
    return {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to) }),
    };
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
