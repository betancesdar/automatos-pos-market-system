import { Controller, Get, Param, Query, Post, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('scan/:barcode')
  async scanProduct(
    @Param('barcode') barcode: string,
    @Query('tenantId') tenantId: string,
  ) {
    if (!tenantId) {
      return { error: 'tenantId is required' };
    }
    return this.catalogService.getProductByBarcode(tenantId, barcode);
  }

  @Post('product')
  async addProduct(
    @Query('tenantId') tenantId: string,
    @Body() body: any,
  ) {
    return this.catalogService.addProduct(tenantId, body);
  }
}
