import { Controller, Post, Get, Body, Query, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SalesService } from './sales.service';
import { NcfType, PaymentMethod } from '@prisma/client';
import { JwtAuthGuard } from '../../common/auth.guard';
import type { TokenPayload } from '../../common/jwt.util';

export class CheckoutDto {
  items: {
    productId: string;
    quantity: number;
    unitPrice?: number;
    isLoose?: boolean;
  }[];
  cashReceived: number;
  ncfType: NcfType;
  applyItbis?: boolean;
  clientRnc?: string;
  clientName?: string;
  paymentMethod?: PaymentMethod;
  discountAmount?: number;
}

export class VoidSaleDto {
  voidReason: string;
}

export class OfflineSaleDto extends CheckoutDto {
  offlineId: string;
  offlineCreatedAt?: string;
}

export class SyncSalesDto {
  sales: OfflineSaleDto[];
}

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(
    @Query('tenantId') tenantId: string,
    @Body() data: CheckoutDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.salesService.checkout(tenantId, data, req.user.sub);
  }

  /**
   * Idempotent bulk-sync endpoint for sales made while the POS was offline.
   * Safe to retry: sales already present (matched by `offlineId`) are
   * reported as "duplicate" and never reprocessed/double-deducted.
   */
  @UseGuards(JwtAuthGuard)
  @Post('sync')
  sync(
    @Query('tenantId') tenantId: string,
    @Body() body: SyncSalesDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.salesService.syncOfflineSales(tenantId, body.sales ?? [], req.user.sub);
  }

  @Get()
  list(
    @Query('tenantId') tenantId: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.salesService.listSales(tenantId, {
      search,
      from,
      to,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  get(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return this.salesService.getSale(tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/void')
  void(
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: VoidSaleDto,
  ) {
    return this.salesService.voidSale(tenantId, id, body.voidReason);
  }
}
