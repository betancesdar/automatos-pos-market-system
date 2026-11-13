import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

@Roles('ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboard(@TenantId() tenantId: string) {
    return this.analyticsService.getDashboard(tenantId);
  }

  @Get('top-products')
  async getTopProducts(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getTopProducts(tenantId, from, to);
  }

  @Get('peak-hours')
  async getPeakHours(@TenantId() tenantId: string) {
    return this.analyticsService.getPeakSalesHours(tenantId);
  }

  @Get('purchase-list')
  async getSmartPurchaseList(@TenantId() tenantId: string) {
    return this.analyticsService.getSmartPurchaseList(tenantId);
  }

  @Get('low-stock')
  async getLowStock(
    @TenantId() tenantId: string,
    @Query('threshold') threshold?: string,
  ) {
    return this.analyticsService.getLowStockAlerts(tenantId, threshold ? parseInt(threshold) : 10);
  }
}
