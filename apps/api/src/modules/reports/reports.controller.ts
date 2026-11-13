import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

@RequirePermissions('reports.view')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  getSalesReport(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getSalesReport(tenantId, from, to);
  }

  @Get('top-products')
  getTopProducts(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportsService.getTopProducts(tenantId, from, to, limit ? parseInt(limit, 10) : undefined);
  }
}
