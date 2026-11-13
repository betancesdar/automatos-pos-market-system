import { Controller, Get, Param, Query, Post, Put, Delete, Body } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Roles } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('categories')
  listCategories(@TenantId() tenantId: string) {
    return this.catalogService.listCategories(tenantId);
  }

  @Get('products')
  listProducts(
    @TenantId() tenantId: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.catalogService.listProducts(tenantId, category, search, categoryId);
  }

  @Get('scan/:barcode')
  scanProduct(@Param('barcode') barcode: string, @TenantId() tenantId: string) {
    return this.catalogService.getProductByBarcode(tenantId, barcode);
  }

  // CASHIER/BILLER included: the POS QuickAdd modal creates products on unknown barcodes.
  @Roles('ADMIN', 'CASHIER', 'BILLER', 'SUPER_ADMIN')
  @Post('product')
  addProduct(@TenantId() tenantId: string, @Body() body: CreateProductDto) {
    return this.catalogService.addProduct(tenantId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('product/:id')
  updateProduct(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(tenantId, id, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete('product/:id')
  deleteProduct(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalogService.deleteProduct(tenantId, id);
  }
}
