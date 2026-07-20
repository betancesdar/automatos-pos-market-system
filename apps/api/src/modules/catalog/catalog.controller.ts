import { Controller, Get, Param, Query, Post, Put, Delete, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  listCategories(@Query('tenantId') tenantId: string) {
    return this.catalogService.listCategories(tenantId);
  }

  @Get('products')
  listProducts(
    @Query('tenantId') tenantId: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.catalogService.listProducts(tenantId, category, search);
  }

  @Get('scan/:barcode')
  scanProduct(@Param('barcode') barcode: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) return { error: 'tenantId is required' };
    return this.catalogService.getProductByBarcode(tenantId, barcode);
  }

  @Post('product')
  addProduct(
    @Query('tenantId') tenantId: string,
    @Body() body: {
      barcode?: string;
      name: string;
      price: number;
      cost?: number;
      stock?: number;
      categoryId?: string;
      imageUrl?: string;
    },
  ) {
    return this.catalogService.addProduct(tenantId, body);
  }

  @Put('product/:id')
  updateProduct(
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: Partial<{
      barcode: string;
      name: string;
      price: number;
      cost: number;
      stock: number;
      categoryId: string;
      imageUrl: string;
    }>,
  ) {
    return this.catalogService.updateProduct(tenantId, id, body);
  }

  @Delete('product/:id')
  deleteProduct(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return this.catalogService.deleteProduct(tenantId, id);
  }
}
