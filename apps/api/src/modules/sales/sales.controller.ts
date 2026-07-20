import { Controller, Post, Body, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { NcfType, PaymentMethod } from '@prisma/client';

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
  paymentMethod?: PaymentMethod;
}

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('checkout')
  checkout(@Query('tenantId') tenantId: string, @Body() data: CheckoutDto) {
    return this.salesService.checkout(tenantId, data);
  }
}
