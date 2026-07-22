import { Controller, Get, Param, Query, Post, Put, Delete, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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
    @Query('categoryId') categoryId?: string,
  ) {
    return this.catalogService.listProducts(tenantId, category, search, categoryId);
  }

  @Get('scan/:barcode')
  scanProduct(@Param('barcode') barcode: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) return { error: 'tenantId is required' };
    return this.catalogService.getProductByBarcode(tenantId, barcode);
  }

  @Post('product')
  addProduct(@Query('tenantId') tenantId: string, @Body() body: CreateProductDto) {
    return this.catalogService.addProduct(tenantId, body);
  }

  @Put('product/:id')
  updateProduct(
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(tenantId, id, body);
  }

  @Delete('product/:id')
  deleteProduct(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return this.catalogService.deleteProduct(tenantId, id);
  }
}
