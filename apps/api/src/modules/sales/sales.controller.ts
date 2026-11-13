import { Controller, Post, Get, Body, Query, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SalesService } from './sales.service';
import { NcfType, PaymentMethod } from '@prisma/client';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';

export class CheckoutItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsBoolean()
  isLoose?: boolean;
}

export class CheckoutDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @IsNumber()
  @Min(0)
  cashReceived: number;

  @IsEnum(NcfType)
  ncfType: NcfType;

  @IsOptional()
  @IsBoolean()
  applyItbis?: boolean;

  @IsOptional()
  @IsString()
  clientRnc?: string;

  @IsOptional()
  @IsString()
  clientName?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;
}

export class VoidSaleDto {
  @IsString()
  @MinLength(1)
  voidReason: string;
}

export class OfflineSaleDto extends CheckoutDto {
  @IsUUID()
  offlineId: string;

  @IsOptional()
  @IsString()
  offlineCreatedAt?: string;
}

export class SyncSalesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleDto)
  sales: OfflineSaleDto[];
}

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @UseGuards(JwtAuthGuard)
  @RequirePermissions('pos.sell')
  @Post('checkout')
  checkout(
    @TenantId() tenantId: string,
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
  @RequirePermissions('pos.sell')
  @Post('sync')
  sync(
    @TenantId() tenantId: string,
    @Body() body: SyncSalesDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.salesService.syncOfflineSales(tenantId, body.sales ?? [], req.user.sub);
  }

  @RequirePermissions('sales.view')
  @Get()
  list(
    @TenantId() tenantId: string,
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

  @RequirePermissions('sales.view')
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.salesService.getSale(tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @RequirePermissions('sales.void')
  @Post(':id/void')
  void(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: VoidSaleDto,
  ) {
    return this.salesService.voidSale(tenantId, id, body.voidReason);
  }
}
