import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType } from '@prisma/client';
import { hashPassword, validateRnc } from '../../common/password.util';
import { signToken } from '../../common/jwt.util';
import { effectivePermissions } from '../../common/permissions.catalog';

function defaultExpiry(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1); // Default to 1 year
  return d;
}

interface CreateTenantInput {
  name: string;
  rnc: string;
  phone?: string;
  address?: string;
  plan?: string;
  adminName: string;
  adminUsername?: string;
  adminEmail: string;
  adminPassword: string;
}

interface UpdateTenantInput {
  name?: string;
  rnc?: string;
  phone?: string;
  address?: string;
  plan?: string;
  planCode?: string;
  workflowMode?: string;
  showProductImages?: boolean;
  expiresAt?: Date;
}

const VALID_WORKFLOW_MODES = ['DIRECT', 'BILLER_CASHIER'];

interface RenewTenantInput {
  option: 'MONTH_1' | 'MONTH_6' | 'YEAR_1' | 'INDEFINITE';
}

@Injectable()
export class SuperadminService {
  constructor(private prisma: PrismaService) {}

  async getMetrics() {
    const [total, active, suspended] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { isActive: true, expiresAt: { gte: new Date() } } }),
      this.prisma.tenant.count({
        where: {
          OR: [{ isActive: false }, { expiresAt: { lt: new Date() } }],
        },
      }),
    ]);
    return { totalTenants: total, activeTenants: active, suspendedTenants: suspended };
  }

  async listTenants() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        users: {
          where: { role: 'ADMIN' },
          select: { id: true, name: true, email: true },
          take: 1,
        },
        _count: { select: { users: true, products: true } },
      },
    });
  }

  async setTenantActive(tenantId: string, isActive: boolean) {
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { isActive },
    });
  }

  async createTenant(data: CreateTenantInput) {
    if (!data.name?.trim()) throw new BadRequestException('Business name is required');
    if (!validateRnc(data.rnc)) throw new BadRequestException('RNC must be 9 or 11 digits');
    if (!data.adminEmail?.trim()) throw new BadRequestException('Admin email is required');
    if (!data.adminPassword || data.adminPassword.length < 4) {
      throw new BadRequestException('Admin password must be at least 4 characters');
    }

    const rnc = data.rnc.replace(/\D/g, '');
    const existingRnc = await this.prisma.tenant.findUnique({ where: { rnc } });
    if (existingRnc) throw new ConflictException('RNC already registered');

    const existingEmail = await this.prisma.user.findUnique({
      where: { email: data.adminEmail.trim().toLowerCase() },
    });
    if (existingEmail) throw new ConflictException('Admin email already in use');

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name.trim(),
          rnc,
          phone: data.phone,
          address: data.address,
          plan: data.plan || 'BASIC',
          isActive: true,
          expiresAt: defaultExpiry(),
        },
      });

      await tx.nCFSequence.createMany({
        data: [
          { tenantId: tenant.id, type: NcfType.CONSUMIDOR_FINAL, prefix: 'B02', nextValue: 1 },
          { tenantId: tenant.id, type: NcfType.CREDITO_FISCAL, prefix: 'B01', nextValue: 1 },
          { tenantId: tenant.id, type: NcfType.GUBERNAMENTAL, prefix: 'B15', nextValue: 1 },
        ],
      });

      const admin = await tx.user.create({
        data: {
          name: data.adminName.trim(),
          // The provisioning UI may omit a username; derive a globally unique
          // login from the email local-part and new tenant ID in that case.
          username: (data.adminUsername?.trim() || `${data.adminEmail.split('@')[0]}-${tenant.id.slice(0, 6)}`).toLowerCase(),
          email: data.adminEmail.trim().toLowerCase(),
          password: hashPassword(data.adminPassword),
          role: 'ADMIN',
          tenantId: tenant.id,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      return { tenant, admin };
    });
  }

  /**
   * Generate impersonation token for a tenant.
   * Returns a short-lived JWT scoped to the tenant with ADMIN role.
   */
  async impersonateTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        users: {
          where: { role: 'ADMIN' },
          select: { id: true, name: true, email: true, username: true },
          take: 1,
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const adminUser = tenant.users[0];
    if (!adminUser) {
      throw new BadRequestException('Tenant has no admin user');
    }

    // Generate a short-lived token (1 hour) for impersonation
    const token = signToken({
      sub: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: 'ADMIN',
      tenantId: tenant.id,
      permissions: effectivePermissions('ADMIN'),
    });

    return {
      token,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        rnc: tenant.rnc,
        plan: tenant.plan,
      },
      user: adminUser,
    };
  }

  /**
   * Update tenant details
   */
  async updateTenant(tenantId: string, data: UpdateTenantInput) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Validate RNC if provided
    if (data.rnc) {
      const cleanRnc = data.rnc.replace(/\D/g, '');
      if (!validateRnc(cleanRnc)) {
        throw new BadRequestException('RNC must be 9 or 11 digits');
      }

      // Check if RNC is already taken by another tenant
      const existing = await this.prisma.tenant.findFirst({
        where: { rnc: cleanRnc, id: { not: tenantId } },
      });
      if (existing) {
        throw new ConflictException('RNC already in use by another tenant');
      }

      data.rnc = cleanRnc;
    }

    if (data.workflowMode && !VALID_WORKFLOW_MODES.includes(data.workflowMode)) {
      throw new BadRequestException(
        `workflowMode must be one of: ${VALID_WORKFLOW_MODES.join(', ')}`,
      );
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: data.name?.trim(),
        rnc: data.rnc,
        phone: data.phone,
        address: data.address,
        plan: data.plan,
        planCode: data.planCode,
        workflowMode: data.workflowMode,
        showProductImages: data.showProductImages,
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Renew/Extend tenant expiration date and activate
   */
  async renewTenant(tenantId: string, input: RenewTenantInput) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    let newExpiry: Date;
    const now = new Date();

    switch (input.option) {
      case 'MONTH_1':
        newExpiry = new Date(now);
        newExpiry.setMonth(newExpiry.getMonth() + 1);
        break;
      case 'MONTH_6':
        newExpiry = new Date(now);
        newExpiry.setMonth(newExpiry.getMonth() + 6);
        break;
      case 'YEAR_1':
        newExpiry = new Date(now);
        newExpiry.setFullYear(newExpiry.getFullYear() + 1);
        break;
      case 'INDEFINITE':
        newExpiry = new Date('2099-12-31');
        break;
      default:
        throw new BadRequestException('Invalid renewal option');
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        expiresAt: newExpiry,
        isActive: true,
      },
    });
  }

  /**
   * Delete tenant and associated data (with cascading)
   */
  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Prisma will handle cascading deletes based on schema relationships
    await this.prisma.tenant.delete({
      where: { id: tenantId },
    });

    return { success: true, message: 'Tenant deleted successfully' };
  }

  // ───────────────────── Métricas de ventas por tenant ─────────────────────

  async tenantMetrics(tenantId: string, range: 'today' | '7d' | '30d' = '30d') {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const now = new Date();
    const from = new Date(now);
    if (range === 'today') from.setHours(0, 0, 0, 0);
    else if (range === '7d') from.setDate(from.getDate() - 7);
    else from.setDate(from.getDate() - 30);

    const [agg, byDayRaw] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { tenantId, status: 'COMPLETED', createdAt: { gte: from } },
        _sum: { total: true, itbis: true },
        _count: true,
      }),
      this.prisma.$queryRaw<{ day: Date; count: bigint; revenue: number }[]>`
        SELECT date_trunc('day', "createdAt") AS day,
               count(*) AS count,
               COALESCE(sum(total), 0) AS revenue
        FROM "Sale"
        WHERE "tenantId" = ${tenantId} AND status = 'COMPLETED' AND "createdAt" >= ${from}
        GROUP BY 1 ORDER BY 1`,
    ]);

    return {
      range,
      salesCount: agg._count,
      revenue: agg._sum.total ?? 0,
      itbis: agg._sum.itbis ?? 0,
      byDay: byDayRaw.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        count: Number(r.count),
        revenue: parseFloat(Number(r.revenue).toFixed(2)),
      })),
    };
  }

  /** Aggregate revenue of the last 30 days across all tenants (one query). */
  async revenueByTenant() {
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const grouped = await this.prisma.sale.groupBy({
      by: ['tenantId'],
      where: { status: 'COMPLETED', createdAt: { gte: from } },
      _sum: { total: true },
      _count: true,
    });
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true },
    });
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));

    return grouped
      .map((g) => ({
        tenantId: g.tenantId,
        tenantName: nameById.get(g.tenantId) ?? '(eliminado)',
        salesCount: g._count,
        revenue: parseFloat((g._sum.total ?? 0).toFixed(2)),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  // ───────────────────── Secuencias NCF por tenant ─────────────────────

  async listNcfSequences(tenantId: string) {
    return this.prisma.nCFSequence.findMany({
      where: { tenantId },
      orderBy: { type: 'asc' },
    });
  }

  async upsertNcfSequence(
    tenantId: string,
    data: { type: NcfType; prefix: string; nextValue: number },
  ) {
    if (!data.prefix?.trim()) throw new BadRequestException('prefix requerido');
    if (!Number.isInteger(data.nextValue) || data.nextValue < 1) {
      throw new BadRequestException('nextValue debe ser un entero >= 1');
    }
    return this.prisma.nCFSequence.upsert({
      where: { tenantId_type: { tenantId, type: data.type } },
      create: { tenantId, type: data.type, prefix: data.prefix.trim(), nextValue: data.nextValue },
      update: { prefix: data.prefix.trim(), nextValue: data.nextValue },
    });
  }

  async deleteNcfSequence(tenantId: string, type: NcfType) {
    await this.prisma.nCFSequence.deleteMany({ where: { tenantId, type } });
    return { success: true };
  }

  // ───────────────────── Planes ─────────────────────

  async listPlans() {
    return this.prisma.plan.findMany({
      orderBy: { monthlyPrice: 'asc' },
      include: { _count: { select: { tenants: true } } },
    });
  }

  async upsertPlan(data: {
    code: string;
    name: string;
    monthlyPrice?: number;
    maxUsers?: number;
    maxProducts?: number;
  }) {
    if (!data.code?.trim() || !data.name?.trim()) {
      throw new BadRequestException('code y name son requeridos');
    }
    const code = data.code.trim().toUpperCase();
    return this.prisma.plan.upsert({
      where: { code },
      create: {
        code,
        name: data.name.trim(),
        monthlyPrice: data.monthlyPrice ?? 0,
        maxUsers: data.maxUsers ?? 5,
        maxProducts: data.maxProducts ?? 1000,
      },
      update: {
        name: data.name.trim(),
        monthlyPrice: data.monthlyPrice,
        maxUsers: data.maxUsers,
        maxProducts: data.maxProducts,
      },
    });
  }

  async deletePlan(code: string) {
    const inUse = await this.prisma.tenant.count({ where: { planCode: code } });
    if (inUse > 0) {
      throw new ConflictException(`Hay ${inUse} tenant(s) usando este plan`);
    }
    await this.prisma.plan.delete({ where: { code } });
    return { success: true };
  }
}
