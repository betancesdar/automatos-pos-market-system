import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function slugify(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async create(tenantId: string, data: { name: string; description?: string }) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException('El nombre de la categoría es obligatorio');

    let slug = slugify(name) || `CAT_${Date.now()}`;
    // Ensure slug uniqueness within tenant
    const existing = await this.prisma.category.findFirst({ where: { tenantId, slug } });
    if (existing) slug = `${slug}_${Date.now().toString().slice(-4)}`;

    return this.prisma.category.create({
      data: { name, slug, description: data.description?.trim() || null, tenantId },
      include: { _count: { select: { products: true } } },
    });
  }

  async update(tenantId: string, id: string, data: { name?: string; description?: string }) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId } });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
      },
      include: { _count: { select: { products: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true } } },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    if (category._count.products > 0) {
      // Detach products instead of blocking deletion so inventory is never orphaned/lost.
      await this.prisma.product.updateMany({
        where: { categoryId: id, tenantId },
        data: { categoryId: null },
      });
    }
    await this.prisma.category.delete({ where: { id } });
    return { deleted: true, detachedProducts: category._count.products };
  }
}
