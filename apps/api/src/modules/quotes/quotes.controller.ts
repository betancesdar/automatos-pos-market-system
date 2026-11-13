import { Controller, Get, Post, Put, Patch, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { QuotesService } from './quotes.service';
import type { QuoteInput } from './quotes.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';
import { TokenPayload } from '../../common/jwt.util';
import { QuoteStatus } from '@prisma/client';

class StatusDto {
  status: QuoteStatus;
}

@Controller('quotes')
@UseGuards(JwtAuthGuard)
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @RequirePermissions('quotes.view')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.quotesService.list(tenantId, { status, search });
  }

  @RequirePermissions('quotes.view')
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.quotesService.get(tenantId, id);
  }

  @RequirePermissions('quotes.manage')
  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() body: QuoteInput,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.quotesService.create(tenantId, req.user.sub, body);
  }

  @RequirePermissions('quotes.manage')
  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: QuoteInput) {
    return this.quotesService.update(tenantId, id, body);
  }

  @RequirePermissions('quotes.manage')
  @Patch(':id/status')
  setStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: StatusDto) {
    return this.quotesService.setStatus(tenantId, id, body.status);
  }

  @RequirePermissions('quotes.convert')
  @Post(':id/convert')
  convert(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Req() req: Request & { user: TokenPayload },
  ) {
    return this.quotesService.convert(tenantId, id, req.user.sub);
  }
}
