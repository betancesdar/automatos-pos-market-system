import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { NcfType } from '@prisma/client';

class UpdateTenantDto {
  name?: string;
  rnc?: string;
  phone?: string;
  address?: string;
  ncfSequences?: { type: NcfType; prefix: string; nextValue: number }[];
}

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getTenant(@Query('tenantId') tenantId: string) {
    return this.tenantService.getTenant(tenantId);
  }

  @Put()
  updateTenant(@Query('tenantId') tenantId: string, @Body() body: UpdateTenantDto) {
    return this.tenantService.updateTenant(tenantId, body);
  }
}
