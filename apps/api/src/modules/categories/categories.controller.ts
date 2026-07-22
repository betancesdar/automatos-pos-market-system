import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';

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
  list(@Query('tenantId') tenantId: string) {
    return this.categoriesService.list(tenantId);
  }

  @Post()
  create(@Query('tenantId') tenantId: string, @Body() body: CreateCategoryDto) {
    return this.categoriesService.create(tenantId, body);
  }

  @Put(':id')
  update(@Query('tenantId') tenantId: string, @Param('id') id: string, @Body() body: UpdateCategoryDto) {
    return this.categoriesService.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return this.categoriesService.remove(tenantId, id);
  }
}
