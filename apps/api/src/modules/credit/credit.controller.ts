import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CreditService } from './credit.service';
import type { CreditCheckoutDto, CreditPaymentDto } from './credit.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import { TokenPayload } from '../../common/jwt.util';

@Controller('credit')
@UseGuards(JwtAuthGuard)
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @RequirePermissions('credit.view')
  @Get('dashboard')
  dashboard(@TenantId() tenantId: string) {
    return this.creditService.dashboard(tenantId);
  }

  @RequirePermissions('credit.view')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.creditService.listReceivables(tenantId, {
      status,
      customerId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @RequirePermissions('credit.view')
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.creditService.getCreditSale(tenantId, id);
  }

  @RequirePermissions('credit.sell')
  @Post('checkout')
  checkout(
    @TenantId() tenantId: string,
    @Body() body: CreditCheckoutDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.creditService.creditCheckout(tenantId, req.user.sub, body);
  }

  @RequirePermissions('credit.sell')
  @Patch(':id/late-fee')
  setLateFee(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { lateFeePercent: number },
  ) {
    return this.creditService.setLateFee(tenantId, id, body.lateFeePercent);
  }

  @RequirePermissions('credit.payment')
  @Post(':id/payments')
  pay(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: CreditPaymentDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.creditService.registerPayment(tenantId, id, req.user.sub, body);
  }
}
