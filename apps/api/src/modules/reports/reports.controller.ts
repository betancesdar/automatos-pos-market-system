import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService, type ReportDimension } from './reports.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

@RequirePermissions('reports.view')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('detailed')
  getDetailed(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('categoryId') categoryId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('cashierId') cashierId?: string,
  ) {
    return this.reportsService.getDetailedReport(tenantId, {
      from, to, groupBy: groupBy as ReportDimension, categoryId, zoneId, paymentMethod, cashierId,
    });
  }

  @Get('detailed/export')
  async exportDetailed(
    @TenantId() tenantId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('format') format?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('categoryId') categoryId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('cashierId') cashierId?: string,
  ): Promise<StreamableFile> {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.reportsService.exportDetailedReport(
      tenantId,
      { from, to, groupBy: groupBy as ReportDimension, categoryId, zoneId, paymentMethod, cashierId },
      fmt,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type':
        fmt === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reporte_${groupBy ?? 'detalle'}_${stamp}.${fmt}"`,
    });
    return new StreamableFile(buffer);
  }

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
