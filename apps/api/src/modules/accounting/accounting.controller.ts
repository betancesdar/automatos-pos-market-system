import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountingService } from './accounting.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';
import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

class CreatePurchaseDto {
  @IsString()
  @MinLength(9)
  supplierRnc: string;

  @IsString()
  @MinLength(1)
  supplierName: string;

  @IsString()
  @MinLength(3)
  ncf: string;

  @IsOptional()
  @IsString()
  ncfType?: string;

  @IsString()
  expenseCategory: string;

  @IsString()
  date: string;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  itbis?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  itbisRetenido?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  isrRetenido?: number;

  @IsNumber()
  @Min(0.01)
  total: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}

class ReviewReconciliationDto {
  @IsIn(['APPROVED', 'OBSERVED'])
  status: 'APPROVED' | 'OBSERVED';

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}

function actorFrom(req: Request & { user: TokenPayload }) {
  return { sub: req.user.sub, username: req.user.username };
}

function parsePeriod(year: string, month: string): { y: number; m: number } {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (!y || y < 2020 || y > 2100 || !m || m < 1 || m > 12) {
    throw new BadRequestException('Período inválido (year/month)');
  }
  return { y, m };
}

@RequirePermissions('accounting.view')
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  // ── Dashboard ──
  @Get('dashboard')
  dashboard(@TenantId() tenantId: string) {
    return this.accountingService.dashboard(tenantId);
  }

  // ── Conciliaciones ──
  @Get('reconciliations')
  listReconciliations(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.accountingService.listReconciliations(tenantId, { from, to, status });
  }

  @RequirePermissions('accounting.manage')
  @Post('reconciliations/:id/review')
  reviewReconciliation(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: ReviewReconciliationDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.reviewReconciliation(tenantId, id, actorFrom(req), body);
  }

  // ── Compras / gastos ──
  @Get('purchases')
  listPurchases(
    @TenantId() tenantId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.accountingService.listPurchases(tenantId, {
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }

  @RequirePermissions('accounting.manage')
  @Post('purchases')
  createPurchase(
    @TenantId() tenantId: string,
    @Body() body: CreatePurchaseDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.createPurchase(tenantId, req.user.sub, body);
  }

  @RequirePermissions('accounting.manage')
  @Patch('purchases/:id')
  updatePurchase(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: Partial<CreatePurchaseDto>,
  ) {
    return this.accountingService.updatePurchase(tenantId, id, body);
  }

  @RequirePermissions('accounting.manage')
  @Delete('purchases/:id')
  deletePurchase(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.accountingService.deletePurchase(tenantId, id);
  }

  // ── Movimientos / asientos manuales ──
  @Get('entries')
  listEntries(
    @TenantId() tenantId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.accountingService.listEntries(tenantId, {
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }

  @RequirePermissions('accounting.manage')
  @Post('entries')
  createEntry(
    @TenantId() tenantId: string,
    @Body() body: { date: string; type: 'INCOME' | 'EXPENSE' | 'ADJUSTMENT'; category: string; amount: number; description?: string },
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.createEntry(tenantId, req.user.sub, body);
  }

  @RequirePermissions('accounting.manage')
  @Delete('entries/:id')
  deleteEntry(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.accountingService.deleteEntry(tenantId, id);
  }

  // ── Drill-down de transacciones ──
  @Get('transactions')
  transactions(
    @TenantId() tenantId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('kind') kind: string,
  ) {
    const { y, m } = parsePeriod(year, month);
    return this.accountingService.transactions(tenantId, y, m, kind);
  }

  // ── Reportes DGII ──
  @Get('reports/606')
  report606(
    @TenantId() tenantId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const { y, m } = parsePeriod(year, month);
    return this.accountingService.report606(tenantId, y, m);
  }

  @Get('reports/607')
  report607(
    @TenantId() tenantId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const { y, m } = parsePeriod(year, month);
    return this.accountingService.report607(tenantId, y, m);
  }

  @Get('reports/608')
  report608(
    @TenantId() tenantId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const { y, m } = parsePeriod(year, month);
    return this.accountingService.report608(tenantId, y, m);
  }

  @Get('reports/itbis-summary')
  itbisSummary(
    @TenantId() tenantId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const { y, m } = parsePeriod(year, month);
    return this.accountingService.itbisSummary(tenantId, y, m);
  }

  // ── Cierre mensual ──
  @Get('periods')
  listPeriods(@TenantId() tenantId: string) {
    return this.accountingService.listPeriods(tenantId);
  }

  @RequirePermissions('accounting.manage')
  @Post('periods/:year/:month/close')
  closePeriod(
    @TenantId() tenantId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.closePeriod(tenantId, year, month, actorFrom(req));
  }

  @RequirePermissions('accounting.manage')
  @Post('periods/:year/:month/approve')
  approvePeriod(
    @TenantId() tenantId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.approvePeriod(tenantId, year, month, actorFrom(req));
  }

  @RequirePermissions('accounting.period.reopen')
  @Post('periods/:year/:month/reopen')
  reopenPeriod(
    @TenantId() tenantId: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.accountingService.reopenPeriod(tenantId, year, month, actorFrom(req));
  }
}
