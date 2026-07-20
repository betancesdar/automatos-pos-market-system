import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
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
}
