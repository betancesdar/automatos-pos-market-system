import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { CustomerInput } from './customers.service';
import { JwtAuthGuard, RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @RequirePermissions('customers.view')
  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('search') search?: string,
    @Query('onlyActive') onlyActive?: string,
  ) {
    return this.customersService.list(tenantId, { search, onlyActive: onlyActive === 'true' });
  }

  @RequirePermissions('customers.view')
  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customersService.get(tenantId, id);
  }

  @RequirePermissions('customers.manage')
  @Post()
  create(@TenantId() tenantId: string, @Body() body: CustomerInput) {
    return this.customersService.create(tenantId, body);
  }

  @RequirePermissions('customers.manage')
  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: CustomerInput) {
    return this.customersService.update(tenantId, id, body);
  }

  @RequirePermissions('customers.manage')
  @Delete(':id')
  deactivate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.customersService.deactivate(tenantId, id);
  }
}
