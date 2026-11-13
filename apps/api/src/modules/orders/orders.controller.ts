import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrdersService } from './orders.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';
import {
  CreateOrderDto,
  UpdateOrderDto,
  OrderCheckoutDto,
  CancelOrderDto,
} from './dto/order.dtos';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @RequirePermissions('orders.create')
  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() body: CreateOrderDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.ordersService.create(tenantId, req.user.sub, body);
  }

  @RequirePermissions('orders.create', 'orders.checkout')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.ordersService.list(tenantId, status, search);
  }

  @RequirePermissions('orders.checkout')
  @Get('by-code/:code')
  getByCode(@TenantId() tenantId: string, @Param('code') code: string) {
    const parsed = parseInt(code.replace(/\D/g, ''), 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new BadRequestException('Código de pedido inválido');
    }
    return this.ordersService.getByCode(tenantId, parsed);
  }

  @RequirePermissions('orders.checkout')
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateOrderDto,
  ) {
    return this.ordersService.update(tenantId, id, body);
  }

  @RequirePermissions('orders.checkout')
  @Post(':id/checkout')
  checkout(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: OrderCheckoutDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.ordersService.checkout(tenantId, id, req.user.sub, body);
  }

  @RequirePermissions('orders.cancel')
  @Post(':id/cancel')
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: CancelOrderDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.ordersService.cancel(
      tenantId,
      id,
      { sub: req.user.sub, role: req.user.role },
      body.reason,
    );
  }
}
