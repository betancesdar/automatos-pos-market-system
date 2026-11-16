import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { EcfService } from './ecf.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

// El comercio solo puede habilitar/deshabilitar su e-CF. El vínculo con la empresa
// asociada en Pronesoft lo configura el SuperAdmin (matriz).
class UpsertEcfConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@Controller('ecf')
export class EcfController {
  constructor(private readonly ecfService: EcfService) {}

  // Disponible para caja/facturador: autocompleta el nombre del cliente por RNC.
  @RequirePermissions('catalog.view')
  @Get('rnc-lookup/:rnc')
  lookupRnc(@Param('rnc') rnc: string) {
    return this.ecfService.lookupRnc(rnc);
  }

  @RequirePermissions('ecf.view')
  @Get('submissions')
  listSubmissions(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.ecfService.listSubmissions(tenantId, status);
  }

  @RequirePermissions('ecf.manage')
  @Post('submissions/:id/retry')
  retry(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ecfService.retrySubmission(tenantId, id);
  }

  @RequirePermissions('ecf.manage')
  @Get('config')
  getConfig(@TenantId() tenantId: string) {
    return this.ecfService.getConfig(tenantId);
  }

  @RequirePermissions('ecf.manage')
  @Put('config')
  upsertConfig(@TenantId() tenantId: string, @Body() body: UpsertEcfConfigDto) {
    return this.ecfService.upsertConfig(tenantId, body);
  }
}
