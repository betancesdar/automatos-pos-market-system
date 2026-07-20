import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NcfType } from '@prisma/client';
import { validateRnc } from '../../common/password.util';

interface NcfSequenceInput {
  type: NcfType;
  prefix: string;
  nextValue: number;
}

interface UpdateTenantInput {
  name?: string;
  rnc?: string;
  phone?: string;
  address?: string;
  ncfSequences?: NcfSequenceInput[];
}

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { ncfSequences: { orderBy: { type: 'asc' } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateTenant(tenantId: string, data: UpdateTenantInput) {
    const existing = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw new NotFoundException('Tenant not found');

    if (data.rnc && !validateRnc(data.rnc)) {
      throw new BadRequestException('RNC must be 9 or 11 digits');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: data.name,
          rnc: data.rnc?.replace(/\D/g, '') || data.rnc,
          phone: data.phone,
          address: data.address,
        },
      });

      if (data.ncfSequences?.length) {
        for (const seq of data.ncfSequences) {
          await tx.nCFSequence.upsert({
            where: { tenantId_type: { tenantId, type: seq.type } },
            create: {
              tenantId,
              type: seq.type,
              prefix: seq.prefix,
              nextValue: seq.nextValue,
            },
            update: {
              prefix: seq.prefix,
              nextValue: seq.nextValue,
            },
          });
        }
      }

      return tx.tenant.findUnique({
        where: { id: tenantId },
        include: { ncfSequences: { orderBy: { type: 'asc' } } },
      });
    });
  }
}
