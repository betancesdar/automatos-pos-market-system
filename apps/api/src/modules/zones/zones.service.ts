import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ZonesService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.zone.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async create(tenantId: string, data: { name: string; description?: string }) {
    const name = data.name?.trim();
    if (!name) throw new BadRequestException('El nombre de la zona es obligatorio');
    const dup = await this.prisma.zone.findFirst({ where: { tenantId, name } });
    if (dup) throw new ConflictException('Ya existe una zona con ese nombre');
    return this.prisma.zone.create({ data: { tenantId, name, description: data.description?.trim() || null } });
  }

  async update(tenantId: string, id: string, data: { name?: string; description?: string; isActive?: boolean }) {
    const zone = await this.prisma.zone.findFirst({ where: { id, tenantId } });
    if (!zone) throw new NotFoundException('Zona no encontrada');
    if (data.name) {
      const dup = await this.prisma.zone.findFirst({ where: { tenantId, name: data.name.trim(), id: { not: id } } });
      if (dup) throw new ConflictException('Ya existe una zona con ese nombre');
    }
    return this.prisma.zone.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const zone = await this.prisma.zone.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true } } },
    });
    if (!zone) throw new NotFoundException('Zona no encontrada');
    // Al eliminar, los productos quedan "Sin zona" (zoneId = null).
    await this.prisma.$transaction([
      this.prisma.product.updateMany({ where: { zoneId: id }, data: { zoneId: null } }),
      this.prisma.zone.delete({ where: { id } }),
    ]);
    return { deleted: true, productsReassigned: zone._count.products };
  }
}
