import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class CloseCashDrawerDto {
  countedCash: number;
  notes?: string;
}

@RequirePermissions('finance.view')
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('summary')
  async getFinancialSummary(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getFinancialSummary(tenantId, from, to);
  }

  @Get('daily')
  async getDailySummary(@TenantId() tenantId: string) {
    return this.financeService.getDailySummary(tenantId);
  }

  @Get('report/607/export')
  async export607Report(
    @TenantId() tenantId: string,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.export607Report(tenantId, format, from, to);
  }

  @Get('report/606')
  async get606Report(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.generate606Report(tenantId, from, to);
  }

  @Get('ncf-log')
  async getNcfLog(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getNcfLog(tenantId, from, to);
  }

  @RequirePermissions('finance.manage')
  @Post('cash-drawer/close')
  async closeCashDrawer(
    @TenantId() tenantId: string,
    @Body() body: CloseCashDrawerDto,
  ) {
    return this.financeService.closeCashDrawer(tenantId, body.countedCash, body.notes);
  }
}
