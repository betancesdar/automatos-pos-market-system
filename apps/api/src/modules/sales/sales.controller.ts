import { Controller, Post, Body, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { NcfType } from '@prisma/client';

export class CheckoutDto {
  items: { productId: string; quantity: number }[];
  cashReceived: number;
  ncfType: NcfType;
  clientRnc?: string;
}

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('checkout')
  async checkout(
    @Query('tenantId') tenantId: string,
    @Body() data: CheckoutDto,
  ) {
    return this.salesService.checkout(tenantId, data);
  }
}
