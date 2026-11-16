import {
  Controller, Get, Param, Query, Post, Put, Delete, Body,
  UseInterceptors, UploadedFile, Res, StreamableFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

interface UploadedFileType {
  originalname: string;
  buffer: Buffer;
  size: number;
}

interface ImportCommitDto {
  rows: string[][];
  mapping: string[];
  hasHeaderRow?: boolean;
  options?: { updateExisting?: boolean; createMissingCategories?: boolean; createMissingZones?: boolean };
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ─────────── Exportar / Importar inventario ───────────

  @RequirePermissions('catalog.view')
  @Get('export')
  async exportProducts(
    @TenantId() tenantId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('format') format?: string,
  ): Promise<StreamableFile> {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.catalogService.exportProducts(tenantId, fmt);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `inventario_${stamp}.${fmt}`;
    res.set({
      'Content-Type':
        fmt === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }

  @RequirePermissions('catalog.manage')
  @Post('import/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseImport(@TenantId() tenantId: string, @UploadedFile() file?: UploadedFileType) {
    if (!file) throw new BadRequestException('Sube un archivo CSV, Excel o XPS.');
    return this.catalogService.parseImportFile(file.buffer, file.originalname);
  }

  @RequirePermissions('catalog.manage')
  @Post('import/commit')
  commitImport(@TenantId() tenantId: string, @Body() body: ImportCommitDto) {
    return this.catalogService.commitImport(tenantId, body);
  }

  @RequirePermissions('catalog.view')
  @Get('categories')
  listCategories(@TenantId() tenantId: string) {
    return this.catalogService.listCategories(tenantId);
  }

  @RequirePermissions('catalog.view')
  @Get('products')
  listProducts(
    @TenantId() tenantId: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('zoneId') zoneId?: string,
  ) {
    return this.catalogService.listProducts(tenantId, category, search, categoryId, zoneId);
  }

  @RequirePermissions('catalog.view')
  @Get('scan/:barcode')
  scanProduct(@Param('barcode') barcode: string, @TenantId() tenantId: string) {
    return this.catalogService.getProductByBarcode(tenantId, barcode);
  }

  // CASHIER/BILLER included: the POS QuickAdd modal creates products on unknown barcodes.
  @RequirePermissions('catalog.create')
  @Post('product')
  addProduct(@TenantId() tenantId: string, @Body() body: CreateProductDto) {
    return this.catalogService.addProduct(tenantId, body);
  }

  @RequirePermissions('catalog.manage')
  @Put('product/:id')
  updateProduct(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(tenantId, id, body);
  }

  @RequirePermissions('catalog.manage')
  @Delete('product/:id')
  deleteProduct(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.catalogService.deleteProduct(tenantId, id);
  }
}
