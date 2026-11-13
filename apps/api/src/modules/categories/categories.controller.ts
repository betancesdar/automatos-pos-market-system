import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { Roles } from '../../common/auth.guard';
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

  @Get()
  list(@TenantId() tenantId: string) {
    return this.categoriesService.list(tenantId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@TenantId() tenantId: string, @Body() body: CreateCategoryDto) {
    return this.categoriesService.create(tenantId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.categoriesService.update(tenantId, id, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.categoriesService.remove(tenantId, id);
  }
}
