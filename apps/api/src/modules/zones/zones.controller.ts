import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class ZoneDto {
  name: string;
  description?: string;
  isActive?: boolean;
}

@Controller('zones')
@UseGuards(JwtAuthGuard)
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @RequirePermissions('catalog.view')
  @Get()
  list(@TenantId() tenantId: string) {
    return this.zonesService.list(tenantId);
  }

  @RequirePermissions('catalog.manage')
  @Post()
  create(@TenantId() tenantId: string, @Body() body: ZoneDto) {
    return this.zonesService.create(tenantId, body);
  }

  @RequirePermissions('catalog.manage')
  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: ZoneDto) {
    return this.zonesService.update(tenantId, id, body);
  }

  @RequirePermissions('catalog.manage')
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.zonesService.remove(tenantId, id);
  }
}
