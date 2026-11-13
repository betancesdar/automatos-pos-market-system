import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { RequirePermissions } from '../../common/auth.guard';
import { TenantId } from '../../common/tenant.decorator';

class CreateCategoryDto {
  name: string;
  description?: string;
}

class UpdateCategoryDto {
  name?: string;
  description?: string;
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @RequirePermissions('catalog.view')
  @Get()
  list(@TenantId() tenantId: string) {
    return this.categoriesService.list(tenantId);
  }

  @RequirePermissions('catalog.manage')
  @Post()
  create(@TenantId() tenantId: string, @Body() body: CreateCategoryDto) {
    return this.categoriesService.create(tenantId, body);
  }

  @RequirePermissions('catalog.manage')
  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.categoriesService.update(tenantId, id, body);
  }

  @RequirePermissions('catalog.manage')
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.categoriesService.remove(tenantId, id);
  }
}
