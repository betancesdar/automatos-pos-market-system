import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CashSessionService } from './cash-session.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import type { TokenPayload } from '../../common/jwt.util';

class OpenCashSessionDto {
  openingBalance: number;
}

class CloseCashSessionDto {
  actualClosingBalance: number;
  /** Dejar el efectivo contado como apertura sugerida de la próxima caja. */
  carryOverToNext?: boolean;
}

class CashMovementDto {
  type: string;
  amount: number;
  reason: string;
  sessionId?: string;
}

@UseGuards(JwtAuthGuard)
@RequirePermissions('cash.view')
@Controller('cash-sessions')
export class CashSessionController {
  constructor(private readonly cashSessionService: CashSessionService) {}

  @Get('current')
  getCurrent(@TenantId() tenantId: string, @Req() req: Request & { user: TokenPayload }) {
    return this.cashSessionService.getCurrent(tenantId, req.user.sub);
  }

  /** Apertura sugerida (carry-over del último cierre marcado), o null. */
  @Get('suggested-opening')
  suggestedOpening(@TenantId() tenantId: string, @Req() req: Request & { user: TokenPayload }) {
    return this.cashSessionService.getSuggestedOpening(tenantId, req.user.sub);
  }

  @Get('live')
  getLive(@TenantId() tenantId: string) {
    return this.cashSessionService.getLiveShift(tenantId);
  }

  @Get('shifts/summary')
  getShiftSummary(
    @TenantId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.cashSessionService.getShiftSummary(tenantId, from, to);
  }

  @RequirePermissions('cash.operate')
  @Post('movements')
  addMovement(@TenantId() tenantId: string, @Body() body: CashMovementDto) {
    return this.cashSessionService.addMovement(tenantId, body);
  }

  @Get()
  list(@TenantId() tenantId: string, @Query('limit') limit?: string) {
    return this.cashSessionService.list(tenantId, limit ? parseInt(limit, 10) : undefined);
  }

  @RequirePermissions('cash.operate')
  @Post('open')
  open(
    @TenantId() tenantId: string,
    @Body() body: OpenCashSessionDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.cashSessionService.open(tenantId, req.user.sub, body.openingBalance);
  }

  @RequirePermissions('cash.operate')
  @Post(':id/close')
  close(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: CloseCashSessionDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.cashSessionService.close(tenantId, req.user.sub, id, body.actualClosingBalance, body.carryOverToNext ?? false);
  }
}
