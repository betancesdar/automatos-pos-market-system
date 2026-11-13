import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class CreateRoleDto {
  name: string;
  description?: string | null;
  permissionCodes: string[];
}

class UpdateRoleDto {
  name?: string;
  description?: string | null;
  permissionCodes?: string[];
}

@Controller('roles')
@UseGuards(JwtAuthGuard)
@RequirePermissions('roles.manage')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('permissions')
  catalog() {
    return this.rolesService.catalog();
  }

  @Get()
  list(@TenantId() tenantId: string) {
    return this.rolesService.list(tenantId);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() body: CreateRoleDto) {
    return this.rolesService.create(tenantId, body);
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: UpdateRoleDto) {
    return this.rolesService.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.rolesService.remove(tenantId, id);
  }
}
