import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  groupedPermissions,
  ROLE_DEFAULTS,
  TENANT_ASSIGNABLE_CODES,
} from '../../common/permissions.catalog';

interface RoleInput {
  name: string;
  description?: string | null;
  permissionCodes: string[];
}

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo de permisos agrupado (para la UI de armado de roles). */
  catalog() {
    return { groups: groupedPermissions() };
  }

  /**
   * Roles disponibles en el comercio: los roles base del sistema (solo lectura,
   * derivados del enum) + los roles personalizados del tenant.
   */
  async list(tenantId: string) {
    const custom = await this.prisma.customRole.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });

    const baseRoles = (['ADMIN', 'CASHIER', 'BILLER', 'ACCOUNTANT'] as const).map((code) => ({
      code,
      permissionCodes: ROLE_DEFAULTS[code] ?? [],
    }));

    return {
      baseRoles,
      customRoles: custom.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        permissionCodes: r.permissionCodes,
        isSystem: r.isSystem,
        userCount: r._count.users,
      })),
    };
  }

  private sanitizeCodes(codes: string[]): string[] {
    const set = new Set(codes.filter((c) => TENANT_ASSIGNABLE_CODES.includes(c)));
    return [...set];
  }

  async create(tenantId: string, input: RoleInput) {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('El nombre del rol es obligatorio');
    const codes = this.sanitizeCodes(input.permissionCodes ?? []);
    if (codes.length === 0) throw new BadRequestException('Selecciona al menos un permiso');

    const existing = await this.prisma.customRole.findFirst({ where: { tenantId, name } });
    if (existing) throw new ConflictException('Ya existe un rol con ese nombre');

    return this.prisma.customRole.create({
      data: { tenantId, name, description: input.description?.trim() || null, permissionCodes: codes },
    });
  }

  async update(tenantId: string, id: string, input: Partial<RoleInput>) {
    const role = await this.prisma.customRole.findFirst({ where: { id, tenantId } });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role.isSystem) throw new BadRequestException('Los roles del sistema no se pueden editar');

    const data: { name?: string; description?: string | null; permissionCodes?: string[] } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('El nombre del rol es obligatorio');
      const dup = await this.prisma.customRole.findFirst({
        where: { tenantId, name, id: { not: id } },
      });
      if (dup) throw new ConflictException('Ya existe un rol con ese nombre');
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.permissionCodes !== undefined) {
      const codes = this.sanitizeCodes(input.permissionCodes);
      if (codes.length === 0) throw new BadRequestException('Selecciona al menos un permiso');
      data.permissionCodes = codes;
    }

    return this.prisma.customRole.update({ where: { id }, data });
  }

  async remove(tenantId: string, id: string) {
    const role = await this.prisma.customRole.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    if (role._count.users > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${role._count.users} empleado(s) tienen este rol. Reasígnalos primero.`,
      );
    }
    await this.prisma.customRole.delete({ where: { id } });
    return { deleted: true };
  }
}
