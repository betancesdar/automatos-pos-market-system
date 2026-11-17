import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards,
  UseInterceptors, UploadedFile, Res, StreamableFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { PurchasingService } from './purchasing.service';
import type {
  SupplierDto, CreateInvoiceDto, SupplierPaymentDto,
} from './purchasing.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';

interface UploadedFileType {
  originalname: string;
  buffer: Buffer;
  size: number;
}

function actorFrom(req: Request & { user: TokenPayload }) {
  return { sub: req.user.sub, username: req.user.username };
}

@Controller('purchasing')
@UseGuards(JwtAuthGuard)
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @RequirePermissions('purchases.view')
  @Get('dashboard')
  dashboard(@TenantId() tenantId: string) {
    return this.purchasing.dashboard(tenantId);
  }

  // ─────────────── Proveedores ───────────────

  @RequirePermissions('purchases.view')
  @Get('suppliers/export')
  async exportSuppliers(
    @TenantId() tenantId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('format') format?: string,
  ): Promise<StreamableFile> {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.purchasing.exportSuppliers(tenantId, fmt);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type':
        fmt === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="proveedores_${stamp}.${fmt}"`,
    });
    return new StreamableFile(buffer);
  }

  @RequirePermissions('purchases.view')
  @Get('suppliers')
  listSuppliers(
    @TenantId() tenantId: string,
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.purchasing.listSuppliers(tenantId, search, activeOnly === 'true');
  }

  @RequirePermissions('purchases.view')
  @Get('suppliers/:id')
  getSupplier(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchasing.getSupplier(tenantId, id);
  }

  @RequirePermissions('purchases.manage')
  @Post('suppliers')
  createSupplier(@TenantId() tenantId: string, @Body() body: SupplierDto) {
    return this.purchasing.createSupplier(tenantId, body);
  }

  @RequirePermissions('purchases.manage')
  @Patch('suppliers/:id')
  updateSupplier(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: Partial<SupplierDto>) {
    return this.purchasing.updateSupplier(tenantId, id, body);
  }

  // ─────────────── Facturas de compra ───────────────

  @RequirePermissions('purchases.view')
  @Get('invoices')
  listInvoices(
    @TenantId() tenantId: string,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.purchasing.listInvoices(tenantId, {
      supplierId,
      status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @RequirePermissions('purchases.view')
  @Get('invoices/:id')
  getInvoice(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.purchasing.getInvoice(tenantId, id);
  }

  @RequirePermissions('purchases.manage')
  @Post('invoices')
  createInvoice(
    @TenantId() tenantId: string,
    @Body() body: CreateInvoiceDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.purchasing.createInvoice(tenantId, req.user.sub, body, actorFrom(req));
  }

  @RequirePermissions('purchases.manage')
  @Post('invoices/:id/payments')
  pay(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: SupplierPaymentDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.purchasing.registerPayment(tenantId, id, req.user.sub, body, actorFrom(req));
  }

  // ─────────────── Importar factura (subir → mapear → confirmar) ───────────────

  @RequirePermissions('purchases.manage')
  @Post('invoices/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseInvoice(@TenantId() tenantId: string, @UploadedFile() file?: UploadedFileType) {
    if (!file) throw new BadRequestException('Sube un archivo CSV, Excel o XPS.');
    return this.purchasing.parseInvoiceFile(file.buffer, file.originalname);
  }

  @RequirePermissions('purchases.manage')
  @Post('invoices/match')
  matchInvoice(
    @TenantId() tenantId: string,
    @Body() body: { rows: string[][]; mapping: string[]; hasHeaderRow?: boolean },
  ) {
    return this.purchasing.matchInvoiceLines(tenantId, body);
  }
}
