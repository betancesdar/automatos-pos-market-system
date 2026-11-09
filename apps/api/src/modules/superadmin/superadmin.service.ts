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
  expiresAt?: Date;
}

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

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: data.name?.trim(),
        rnc: data.rnc,
        phone: data.phone,
        address: data.address,
        plan: data.plan,
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
}
