import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // TOP 5 BEST-SELLING PRODUCTS (by Volume and by Revenue)
  // ──────────────────────────────────────────────────────────────────────────
  async getTopProducts(tenantId: string, from?: string, to?: string) {
    const dateFilter = from ? { gte: new Date(from), ...(to && { lte: new Date(to) }) } : undefined;

    const saleItems = await this.prisma.saleItem.findMany({
      where: {
        sale: { tenantId, ...(dateFilter && { createdAt: dateFilter }) },
      },
      include: { product: true },
    });

    // Aggregate per product
    const productMap = new Map<string, { name: string; totalQty: number; totalRevenue: number }>();

    for (const item of saleItems) {
      const existing = productMap.get(item.productId) ?? {
        name: item.product.name,
        totalQty: 0,
        totalRevenue: 0,
      };
      existing.totalQty += item.quantity;
      existing.totalRevenue += item.price * item.quantity;
      productMap.set(item.productId, existing);
    }

    const products = Array.from(productMap.entries()).map(([id, data]) => ({ id, ...data }));

    const byVolume = [...products]
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 5)
      .map((p) => ({ ...p, totalRevenue: parseFloat(p.totalRevenue.toFixed(2)) }));

    const byRevenue = [...products]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5)
      .map((p) => ({ ...p, totalRevenue: parseFloat(p.totalRevenue.toFixed(2)) }));

    return { byVolume, byRevenue };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PEAK SALES HOURS (grouped by hour of day, last 30 days)
  // ──────────────────────────────────────────────────────────────────────────
  async getPeakSalesHours(tenantId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } },
      select: { createdAt: true, total: true },
    });

    // Group by hour of day (0–23)
    const hourMap = new Array(24).fill(0).map((_, h) => ({
      hour: h,
      label: `${h.toString().padStart(2, '0')}:00`,
      salesCount: 0,
      totalRevenue: 0,
    }));

    for (const sale of sales) {
      const hour = sale.createdAt.getHours();
      hourMap[hour].salesCount += 1;
      hourMap[hour].totalRevenue += sale.total;
    }

    hourMap.forEach((h) => {
      h.totalRevenue = parseFloat(h.totalRevenue.toFixed(2));
    });

    return hourMap;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SEMI-AI SMART PURCHASE LIST
  // Calculates 7-day average sales velocity per product and recommends
  // exactly how many units to order to cover the next 7 days.
  // ──────────────────────────────────────────────────────────────────────────
  async getSmartPurchaseList(tenantId: string) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get all products with their current stock
    const [products, saleItems] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.saleItem.findMany({
        where: { sale: { tenantId, createdAt: { gte: sevenDaysAgo } } },
        include: { product: true },
      }),
    ]);

    // Build velocity map: productId → total sold in last 7 days
    const velocityMap = new Map<string, number>();
    for (const item of saleItems) {
      velocityMap.set(item.productId, (velocityMap.get(item.productId) ?? 0) + item.quantity);
    }

    const suggestions: {
      productId: string;
      name: string;
      barcode: string | null;
      currentStock: number;
      dailyVelocity: number;
      soldLast7Days: number;
      projectedDemand7Days: number;
      unitsToOrder: number;
      estimatedCost: number;
      urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    }[] = [];

    for (const product of products) {
      const soldLast7Days = velocityMap.get(product.id) ?? 0;
      const dailyVelocity = soldLast7Days / 7;
      const projectedDemand7Days = Math.ceil(dailyVelocity * 7);
      const unitsNeeded = Math.max(0, projectedDemand7Days - product.stock);

      // Flag as low-stock if current stock < 2x the daily velocity
      const isLowStock = product.stock < dailyVelocity * 2;

      if (isLowStock || unitsNeeded > 0) {
        suggestions.push({
          productId: product.id,
          name: product.name,
          barcode: product.barcode,
          currentStock: product.stock,
          dailyVelocity: parseFloat(dailyVelocity.toFixed(2)),
          soldLast7Days,
          projectedDemand7Days,
          unitsToOrder: unitsNeeded,
          estimatedCost: parseFloat((unitsNeeded * product.cost).toFixed(2)),
          urgency:
            product.stock === 0
              ? 'CRITICAL'
              : product.stock < dailyVelocity
              ? 'HIGH'
              : 'MEDIUM',
        });
      }
    }

    // Sort by urgency: CRITICAL first, then HIGH, then MEDIUM
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    suggestions.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    const totalEstimatedInvestment = parseFloat(
      suggestions.reduce((s, p) => s + p.estimatedCost, 0).toFixed(2),
    );

    return {
      generatedAt: new Date().toISOString(),
      totalProducts: suggestions.length,
      totalEstimatedInvestment,
      suggestions,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOW STOCK ALERTS (real-time)
  // ──────────────────────────────────────────────────────────────────────────
  async getLowStockAlerts(tenantId: string, threshold = 10) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, stock: { lte: threshold } },
      orderBy: { stock: 'asc' },
    });

    return {
      threshold,
      count: products.length,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        stock: p.stock,
        urgency: p.stock === 0 ? 'OUT_OF_STOCK' : p.stock <= 3 ? 'CRITICAL' : 'LOW',
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FULL ADMIN DASHBOARD: single endpoint aggregating everything
  // ──────────────────────────────────────────────────────────────────────────
  async getDashboard(tenantId: string) {
    const [topProducts, peakHours, purchaseList, lowStock] = await Promise.all([
      this.getTopProducts(tenantId),
      this.getPeakSalesHours(tenantId),
      this.getSmartPurchaseList(tenantId),
      this.getLowStockAlerts(tenantId),
    ]);

    return { topProducts, peakHours, purchaseList, lowStock };
  }
}
