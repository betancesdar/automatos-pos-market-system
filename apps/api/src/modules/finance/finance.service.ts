import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType } from '@prisma/client';

const ITBIS_RATE = 0.18; // 18% Dominican ITBIS tax

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // FINANCIAL SUMMARY: Gross Sales, Net Profit, ITBIS
  // ──────────────────────────────────────────────────────────────────────────
  async getFinancialSummary(tenantId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId, createdAt: dateFilter },
      include: { items: { include: { product: true } } },
    });

    let grossRevenue = 0;
    let totalCost = 0;
    let totalItbis = 0;

    for (const sale of sales) {
      grossRevenue += sale.total;
      totalItbis += sale.itbis;
      for (const item of sale.items) {
        totalCost += item.cost * item.quantity;
      }
    }

    const netProfit = grossRevenue - totalCost;
    const grossMarginPercent = grossRevenue > 0 ? ((netProfit / grossRevenue) * 100).toFixed(2) : '0.00';

    return {
      period: { from: from || 'all-time', to: to || 'now' },
      totalSales: sales.length,
      grossRevenue: parseFloat(grossRevenue.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      grossMarginPercent: parseFloat(grossMarginPercent),
      totalItbis: parseFloat(totalItbis.toFixed(2)),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DGII 606 REPORT: All Crédito Fiscal (B01) sales for declaration
  // Formatted per DGII specification for 606 purchases/sales form
  // ──────────────────────────────────────────────────────────────────────────
  async generate606Report(tenantId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to);

    const creditoFiscalSales = await this.prisma.sale.findMany({
      where: {
        tenantId,
        ncfType: NcfType.CREDITO_FISCAL,
        createdAt: dateFilter,
      },
      include: { items: true },
    });

    const report606 = creditoFiscalSales.map((sale) => {
      const taxableAmount = parseFloat((sale.total / (1 + ITBIS_RATE)).toFixed(2));
      const itbis = parseFloat((sale.total - taxableAmount).toFixed(2));

      return {
        rnc_cedula_tercero: sale.clientRnc || 'N/A',
        tipo_bienes_servicios_compras: '01', // Bienes
        ncf: sale.ncf || 'N/A',
        fecha: sale.createdAt.toISOString().split('T')[0],
        monto_facturado_servicios: 0,
        monto_facturado_bienes: taxableAmount,
        itbis_facturado: itbis,
        total_monto_facturado: parseFloat(sale.total.toFixed(2)),
      };
    });

    return {
      tenantId,
      reportType: '607', // 607 is for income/sales NCF report
      generatedAt: new Date().toISOString(),
      totalRecords: report606.length,
      totalAmount: parseFloat(report606.reduce((s, r) => s + r.total_monto_facturado, 0).toFixed(2)),
      records: report606,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CIERRE DE CAJA (Daily Cash Drawer Close)
  // ──────────────────────────────────────────────────────────────────────────
  async closeCashDrawer(tenantId: string, countedCash: number, notes?: string) {
    // Sum all cashReceived for today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaySales = await this.prisma.sale.aggregate({
      where: {
        tenantId,
        createdAt: { gte: todayStart },
        cashReceived: { not: null },
      },
      _sum: { cashReceived: true },
    });

    const expectedCash = todaySales._sum.cashReceived ?? 0;
    const discrepancy = parseFloat((countedCash - expectedCash).toFixed(2));

    const log = await this.prisma.cashDrawerLog.create({
      data: {
        tenantId,
        expectedCash: parseFloat(expectedCash.toFixed(2)),
        countedCash: parseFloat(countedCash.toFixed(2)),
        discrepancy,
        notes,
      },
    });

    return {
      ...log,
      status: discrepancy === 0 ? 'BALANCED' : discrepancy > 0 ? 'SOBRANTE' : 'FALTANTE',
      message:
        discrepancy === 0
          ? '✅ Caja cuadrada perfectamente.'
          : discrepancy > 0
          ? `⚠️ Sobrante de RD$ ${Math.abs(discrepancy).toFixed(2)}`
          : `🚨 Faltante de RD$ ${Math.abs(discrepancy).toFixed(2)}`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Daily Sales Summary (for admin dashboard)
  // ──────────────────────────────────────────────────────────────────────────
  async getDailySummary(tenantId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [summary, cashLogs] = await Promise.all([
      this.getFinancialSummary(tenantId, todayStart.toISOString()),
      this.prisma.cashDrawerLog.findMany({
        where: { tenantId, createdAt: { gte: todayStart } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return { ...summary, cashDrawerLogs: cashLogs };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NCF LOG: All NCFs issued within date range
  // ──────────────────────────────────────────────────────────────────────────
  async getNcfLog(tenantId: string, from?: string, to?: string) {
    const dateFilter = this.buildDateFilter(from, to);

    const sales = await this.prisma.sale.findMany({
      where: { tenantId, ncf: { not: null }, createdAt: dateFilter },
      select: {
        id: true,
        ncf: true,
        ncfType: true,
        total: true,
        itbis: true,
        clientRnc: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { total: sales.length, records: sales };
  }

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) return undefined;
    return {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to) }),
    };
  }
}
