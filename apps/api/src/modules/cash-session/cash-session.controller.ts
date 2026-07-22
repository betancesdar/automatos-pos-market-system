import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CashSessionService } from './cash-session.service';
import { JwtAuthGuard } from '../../common/auth.guard';
import type { TokenPayload } from '../../common/jwt.util';

class OpenCashSessionDto {
  openingBalance: number;
}

class CloseCashSessionDto {
  actualClosingBalance: number;
}

class CashMovementDto {
  type: string;
  amount: number;
  reason: string;
  sessionId?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('cash-sessions')
export class CashSessionController {
  constructor(private readonly cashSessionService: CashSessionService) {}

  @Get('current')
  getCurrent(@Query('tenantId') tenantId: string, @Req() req: Request & { user: TokenPayload }) {
    return this.cashSessionService.getCurrent(tenantId, req.user.sub);
  }

  @Get('live')
  getLive(@Query('tenantId') tenantId: string) {
    return this.cashSessionService.getLiveShift(tenantId);
  }

  @Get('shifts/summary')
  getShiftSummary(
    @Query('tenantId') tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.cashSessionService.getShiftSummary(tenantId, from, to);
  }

  @Post('movements')
  addMovement(@Query('tenantId') tenantId: string, @Body() body: CashMovementDto) {
    return this.cashSessionService.addMovement(tenantId, body);
  }

  @Get()
  list(@Query('tenantId') tenantId: string, @Query('limit') limit?: string) {
    return this.cashSessionService.list(tenantId, limit ? parseInt(limit, 10) : undefined);
  }

  @Post('open')
  open(
    @Query('tenantId') tenantId: string,
    @Body() body: OpenCashSessionDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.cashSessionService.open(tenantId, req.user.sub, body.openingBalance);
  }

  @Post(':id/close')
  close(
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: CloseCashSessionDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.cashSessionService.close(tenantId, req.user.sub, id, body.actualClosingBalance);
  }
}
