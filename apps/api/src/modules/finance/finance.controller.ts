import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';

class CloseCashDrawerDto {
  countedCash: number;
  notes?: string;
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('summary')
  async getFinancialSummary(
    @Query('tenantId') tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getFinancialSummary(tenantId, from, to);
  }

  @Get('daily')
  async getDailySummary(@Query('tenantId') tenantId: string) {
    return this.financeService.getDailySummary(tenantId);
  }

  @Get('report/607/export')
  async export607Report(
    @Query('tenantId') tenantId: string,
    @Query('format') format: 'json' | 'csv' = 'json',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.export607Report(tenantId, format, from, to);
  }

  @Get('report/606')
  async get606Report(
    @Query('tenantId') tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.generate606Report(tenantId, from, to);
  }

  @Get('ncf-log')
  async getNcfLog(
    @Query('tenantId') tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.financeService.getNcfLog(tenantId, from, to);
  }

  @Post('cash-drawer/close')
  async closeCashDrawer(
    @Query('tenantId') tenantId: string,
    @Body() body: CloseCashDrawerDto,
  ) {
    return this.financeService.closeCashDrawer(tenantId, body.countedCash, body.notes);
  }
}
