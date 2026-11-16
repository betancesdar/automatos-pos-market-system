import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SuperadminService } from './superadmin.service';
import { EcfService } from '../ecf/ecf.service';
import { AuditService } from '../../common/audit.module';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import type { TokenPayload } from '../../common/jwt.util';
import { NcfType } from '@prisma/client';

class CreateTenantDto {
  name: string;
  rnc: string;
  phone?: string;
  address?: string;
  plan?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

class SetActiveDto {
  isActive: boolean;
}

class UpdateTenantDto {
  name?: string;
  rnc?: string;
  phone?: string;
  address?: string;
  plan?: string;
  planCode?: string;
  workflowMode?: string; // "DIRECT" | "BILLER_CASHIER"
  showProductImages?: boolean; // POS: grid con fotos (true) o tabla compacta (false)
  expiresAt?: string; // ISO date string
}

class RenewTenantDto {
  option: 'MONTH_1' | 'MONTH_6' | 'YEAR_1' | 'INDEFINITE';
}

class UpsertNcfSequenceDto {
  type: NcfType;
  prefix: string;
  nextValue: number;
}

class UpsertPlanDto {
  code: string;
  name: string;
  monthlyPrice?: number;
  maxUsers?: number;
  maxProducts?: number;
}

class UpsertEcfConfigDto {
  enabled?: boolean;
  pronesoftBusinessId?: string | null;
  pronesoftRnc?: string | null;
}

class PlatformEcfConfigDto {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
}

class CreateSequenceDto {
  type!: string;
  from!: number;
  to!: number;
  quantity?: number;
  expiration?: string;
}

@Controller('superadmin')
@UseGuards(JwtAuthGuard)
@RequirePermissions('platform.admin')
export class SuperadminController {
  constructor(
    private readonly superadminService: SuperadminService,
    private readonly ecfService: EcfService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: Request & { user: TokenPayload }) {
    return { sub: req.user.sub, username: req.user.username };
  }

  @Get('metrics')
  getMetrics() {
    return this.superadminService.getMetrics();
  }

  @Get('metrics/revenue')
  revenueByTenant() {
    return this.superadminService.revenueByTenant();
  }

  @Get('tenants')
  listTenants() {
    return this.superadminService.listTenants();
  }

  @Get('tenants/:id/metrics')
  tenantMetrics(@Param('id') id: string, @Query('range') range?: string) {
    const valid = range === 'today' || range === '7d' || range === '30d' ? range : '30d';
    return this.superadminService.tenantMetrics(id, valid);
  }

  @Patch('tenants/:id/status')
  setStatus(
    @Param('id') id: string,
    @Body() body: SetActiveDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), body.isActive ? 'TENANT_ACTIVATE' : 'TENANT_SUSPEND', id);
    return this.superadminService.setTenantActive(id, body.isActive);
  }

  @Post('tenants')
  async createTenant(
    @Body() body: CreateTenantDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    const result = await this.superadminService.createTenant(body);
    this.audit.log(this.actor(req), 'TENANT_CREATE', (result as { tenant?: { id?: string } }).tenant?.id, {
      name: body.name,
      rnc: body.rnc,
    });
    return result;
  }

  @Post('tenants/:id/impersonate')
  impersonateTenant(@Param('id') id: string, @Req() req: Request & { user: TokenPayload }) {
    this.audit.log(this.actor(req), 'IMPERSONATE', id);
    return this.superadminService.impersonateTenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id') id: string,
    @Body() body: UpdateTenantDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    const data = {
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    };
    this.audit.log(this.actor(req), 'TENANT_UPDATE', id, { fields: Object.keys(body) });
    return this.superadminService.updateTenant(id, data);
  }

  @Post('tenants/:id/renew')
  renewTenant(
    @Param('id') id: string,
    @Body() body: RenewTenantDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), 'TENANT_RENEW', id, { option: body.option });
    return this.superadminService.renewTenant(id, body);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string, @Req() req: Request & { user: TokenPayload }) {
    this.audit.log(this.actor(req), 'TENANT_DELETE', id);
    return this.superadminService.deleteTenant(id);
  }

  // ── Config fiscal por tenant: secuencias NCF ──

  @Get('tenants/:id/ncf-sequences')
  listNcfSequences(@Param('id') id: string) {
    return this.superadminService.listNcfSequences(id);
  }

  @Post('tenants/:id/ncf-sequences')
  upsertNcfSequence(
    @Param('id') id: string,
    @Body() body: UpsertNcfSequenceDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), 'NCF_SEQUENCE_UPSERT', id, { type: body.type, prefix: body.prefix });
    return this.superadminService.upsertNcfSequence(id, body);
  }

  @Delete('tenants/:id/ncf-sequences/:type')
  deleteNcfSequence(
    @Param('id') id: string,
    @Param('type') type: NcfType,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), 'NCF_SEQUENCE_DELETE', id, { type });
    return this.superadminService.deleteNcfSequence(id, type);
  }

  // ── Config e-CF MATRIZ (plataforma) ──

  @Get('ecf/platform-config')
  getPlatformEcf() {
    return this.ecfService.getPlatformConfig();
  }

  @Put('ecf/platform-config')
  upsertPlatformEcf(@Body() body: PlatformEcfConfigDto, @Req() req: Request & { user: TokenPayload }) {
    this.audit.log(this.actor(req), 'PLATFORM_ECF_UPDATE', null, {
      enabled: body.enabled,
    });
    return this.ecfService.upsertPlatformConfig(body);
  }

  /** Lista las empresas asociadas de la cuenta matriz en Pronesoft (para vincular). */
  @Get('ecf/associated-companies')
  associatedCompanies() {
    return this.ecfService.listAssociatedCompanies();
  }

  // ── Vínculo e-CF por comercio + secuencias ──

  @Get('tenants/:id/ecf-config')
  getEcfConfig(@Param('id') id: string) {
    return this.ecfService.getConfig(id);
  }

  @Put('tenants/:id/ecf-config')
  upsertEcfConfig(
    @Param('id') id: string,
    @Body() body: UpsertEcfConfigDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), 'TENANT_ECF_LINK', id, {
      enabled: body.enabled,
      pronesoftBusinessId: body.pronesoftBusinessId,
    });
    return this.ecfService.upsertConfig(id, body);
  }

  @Get('tenants/:id/ecf/sequences')
  tenantSequences(@Param('id') id: string, @Query('type') type?: string) {
    return this.ecfService.tenantSequences(id, type);
  }

  @Post('tenants/:id/ecf/sequences')
  createTenantSequence(
    @Param('id') id: string,
    @Body() body: CreateSequenceDto,
    @Req() req: Request & { user: TokenPayload },
  ) {
    this.audit.log(this.actor(req), 'ECF_SEQUENCE_CREATE', id, { type: body.type, from: body.from, to: body.to });
    return this.ecfService.createTenantSequence(id, { ...body });
  }

  // ── Planes ──

  @Get('plans')
  listPlans() {
    return this.superadminService.listPlans();
  }

  @Post('plans')
  upsertPlan(@Body() body: UpsertPlanDto, @Req() req: Request & { user: TokenPayload }) {
    this.audit.log(this.actor(req), 'PLAN_UPSERT', null, { code: body.code });
    return this.superadminService.upsertPlan(body);
  }

  @Delete('plans/:code')
  deletePlan(@Param('code') code: string, @Req() req: Request & { user: TokenPayload }) {
    this.audit.log(this.actor(req), 'PLAN_DELETE', null, { code });
    return this.superadminService.deletePlan(code);
  }

  // ── Auditoría ──

  @Get('audit-logs')
  auditLogs(@Query('tenantId') tenantId?: string, @Query('limit') limit?: string) {
    return this.audit.list({
      tenantId: tenantId || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
