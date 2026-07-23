import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType } from '@prisma/client';
import { hashPassword, validateRnc } from '../../common/password.util';

function defaultExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30);
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
}
