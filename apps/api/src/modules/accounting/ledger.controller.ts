import {
  Controller, Get, Post, Patch, Put, Body, Param, Query, Req,
  UseInterceptors, UploadedFile, Res, StreamableFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { LedgerService } from './ledger.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';
import { AccountType } from '@prisma/client';

interface UploadedFileType { originalname: string; buffer: Buffer; size: number }
function actorFrom(req: Request & { user: TokenPayload }) {
  return { sub: req.user.sub, username: req.user.username };
}

@RequirePermissions('accounting.view')
@Controller('accounting')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  // ── Catálogo de cuentas ──
  @Get('accounts/export')
  async exportAccounts(@TenantId() tenantId: string, @Res({ passthrough: true }) res: Response, @Query('format') format?: string): Promise<StreamableFile> {
    const fmt = format === 'xlsx' ? 'xlsx' : 'csv';
    const buffer = await this.ledger.exportAccounts(tenantId, fmt);
    res.set({
      'Content-Type': fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="catalogo_cuentas.${fmt}"`,
    });
    return new StreamableFile(buffer);
  }

  @Get('accounts')
  listAccounts(@TenantId() tenantId: string) {
    return this.ledger.listAccounts(tenantId);
  }

  @RequirePermissions('accounting.manage')
  @Post('accounts')
  createAccount(@TenantId() tenantId: string, @Body() body: { code: string; name: string; type: AccountType; parentId?: string | null }) {
    return this.ledger.createAccount(tenantId, body);
  }

  @RequirePermissions('accounting.manage')
  @Patch('accounts/:id')
  updateAccount(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: { name?: string; active?: boolean }) {
    return this.ledger.updateAccount(tenantId, id, body);
  }

  @RequirePermissions('accounting.manage')
  @Post('accounts/import/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  parseAccounts(@TenantId() tenantId: string, @UploadedFile() file?: UploadedFileType) {
    if (!file) throw new BadRequestException('Sube un archivo CSV o Excel.');
    return this.ledger.parseAccountsFile(file.buffer, file.originalname);
  }

  @RequirePermissions('accounting.manage')
  @Post('accounts/import/commit')
  commitAccounts(@TenantId() tenantId: string, @Body() body: { rows: string[][]; mapping: string[]; hasHeaderRow?: boolean }) {
    return this.ledger.commitAccountsImport(tenantId, body);
  }

  // ── Mapeo de cuentas (auto-posting) ──
  @Get('mappings')
  mappings(@TenantId() tenantId: string) {
    return this.ledger.getMappings(tenantId);
  }

  @RequirePermissions('accounting.manage')
  @Put('mappings')
  setMapping(@TenantId() tenantId: string, @Body() body: { role: string; accountId: string }) {
    return this.ledger.setMapping(tenantId, body.role, body.accountId);
  }

  // ── Libro diario / asientos ──
  @Get('journal')
  journal(@TenantId() tenantId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ledger.listJournal(tenantId, from, to);
  }

  @RequirePermissions('accounting.manage')
  @Post('journal')
  createEntry(
    @TenantId() tenantId: string,
    @Body() body: { date: string; memo?: string; lines: { accountId: string; debit?: number; credit?: number }[] },
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.ledger.createManualEntry(tenantId, req.user.sub, body, actorFrom(req));
  }

  @RequirePermissions('accounting.manage')
  @Post('journal/sync')
  sync(@TenantId() tenantId: string, @Body() body: { from: string; to: string }, @Req() req: Request & { user: TokenPayload }) {
    if (!body.from || !body.to) throw new BadRequestException('Indica el rango de fechas (from, to)');
    return this.ledger.syncFromSources(tenantId, body.from, body.to, actorFrom(req));
  }

  // ── Libro mayor ──
  @Get('ledger/:accountId')
  ledgerAccount(@TenantId() tenantId: string, @Param('accountId') accountId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ledger.ledgerForAccount(tenantId, accountId, from, to);
  }

  // ── Estados financieros ──
  @Get('reports/balance-sheet')
  balanceSheet(@TenantId() tenantId: string, @Query('asOf') asOf: string) {
    return this.ledger.balanceSheet(tenantId, asOf || new Date().toISOString().slice(0, 10));
  }

  @Get('reports/income-statement')
  incomeStatement(@TenantId() tenantId: string, @Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new BadRequestException('Indica el rango (from, to)');
    return this.ledger.incomeStatement(tenantId, from, to);
  }
}
