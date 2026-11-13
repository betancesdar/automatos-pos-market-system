import { Controller, Get, Put, Body } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { NcfType } from '@prisma/client';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class UpdateTenantDto {
  name?: string;
  rnc?: string;
  phone?: string;
  address?: string;
  commercialName?: string;
  receiptLogoUrl?: string;
  receiptFooter?: string;
  paperSize?: string;
  ncfSequences?: { type: NcfType; prefix: string; nextValue: number }[];
}

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  // All roles: the POS needs the tenant profile (receipt config, workflowMode).
  @Get()
  getTenant(@TenantId() tenantId: string) {
    return this.tenantService.getTenant(tenantId);
  }

  @RequirePermissions('tenant.manage')
  @Put()
  updateTenant(@TenantId() tenantId: string, @Body() body: UpdateTenantDto) {
    return this.tenantService.updateTenant(tenantId, body);
  }
}
