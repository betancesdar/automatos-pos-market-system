import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SuperadminService } from './superadmin.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/auth.guard';

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
  expiresAt?: string; // ISO date string
}

class RenewTenantDto {
  option: 'MONTH_1' | 'MONTH_6' | 'YEAR_1' | 'INDEFINITE';
}

@Controller('superadmin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SuperadminController {
  constructor(private readonly superadminService: SuperadminService) {}

  @Get('metrics')
  getMetrics() {
    return this.superadminService.getMetrics();
  }

  @Get('tenants')
  listTenants() {
    return this.superadminService.listTenants();
  }

  @Patch('tenants/:id/status')
  setStatus(@Param('id') id: string, @Body() body: SetActiveDto) {
    return this.superadminService.setTenantActive(id, body.isActive);
  }

  @Post('tenants')
  createTenant(@Body() body: CreateTenantDto) {
    return this.superadminService.createTenant(body);
  }

  @Post('tenants/:id/impersonate')
  impersonateTenant(@Param('id') id: string) {
    return this.superadminService.impersonateTenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() body: UpdateTenantDto) {
    const data = {
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    };
    return this.superadminService.updateTenant(id, data);
  }

  @Post('tenants/:id/renew')
  renewTenant(@Param('id') id: string, @Body() body: RenewTenantDto) {
    return this.superadminService.renewTenant(id, body);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) {
    return this.superadminService.deleteTenant(id);
  }
}
