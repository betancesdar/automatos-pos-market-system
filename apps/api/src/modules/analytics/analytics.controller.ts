import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboard(@Query('tenantId') tenantId: string) {
    return this.analyticsService.getDashboard(tenantId);
  }

  @Get('top-products')
  async getTopProducts(
    @Query('tenantId') tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getTopProducts(tenantId, from, to);
  }

  @Get('peak-hours')
  async getPeakHours(@Query('tenantId') tenantId: string) {
    return this.analyticsService.getPeakSalesHours(tenantId);
  }

  @Get('purchase-list')
  async getSmartPurchaseList(@Query('tenantId') tenantId: string) {
    return this.analyticsService.getSmartPurchaseList(tenantId);
  }

  @Get('low-stock')
  async getLowStock(
    @Query('tenantId') tenantId: string,
    @Query('threshold') threshold?: string,
  ) {
    return this.analyticsService.getLowStockAlerts(tenantId, threshold ? parseInt(threshold) : 10);
  }
}
