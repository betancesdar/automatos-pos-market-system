import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerDocType, Prisma } from '@prisma/client';

export interface CustomerInput {
  name: string;
  docType?: CustomerDocType;
  docNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  creditLimit?: number;
  notes?: string | null;
  isActive?: boolean;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string, opts?: { search?: string; onlyActive?: boolean }) {
    const where: Prisma.CustomerWhereInput = { tenantId };
    if (opts?.onlyActive) where.isActive = true;
    const term = opts?.search?.trim();
    if (term) {
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { docNumber: { contains: term.replace(/\D/g, '') || term } },
        { phone: { contains: term } },
      ];
    }
    return this.prisma.customer.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take: 100,
    });
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  private normalize(input: CustomerInput) {
    const docType = input.docType ?? CustomerDocType.NONE;
    const docNumber =
      docType === CustomerDocType.NONE ? null : input.docNumber?.replace(/\D/g, '') || null;
    return {
      name: input.name?.trim(),
      docType,
      docNumber,
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      address: input.address?.trim() || null,
      creditLimit: new Prisma.Decimal(input.creditLimit ?? 0),
      notes: input.notes?.trim() || null,
    };
  }

  async create(tenantId: string, input: CustomerInput) {
    if (!input.name?.trim()) throw new BadRequestException('El nombre es obligatorio');
    const data = this.normalize(input);
    if (data.docNumber) {
      const dup = await this.prisma.customer.findFirst({
        where: { tenantId, docNumber: data.docNumber },
      });
      if (dup) throw new ConflictException(`Ya existe un cliente con ese documento (${dup.name})`);
    }
    return this.prisma.customer.create({ data: { tenantId, ...data } });
  }

  async update(tenantId: string, id: string, input: CustomerInput) {
    await this.get(tenantId, id);
    const data = this.normalize(input);
    if (data.docNumber) {
      const dup = await this.prisma.customer.findFirst({
        where: { tenantId, docNumber: data.docNumber, id: { not: id } },
      });
      if (dup) throw new ConflictException(`Ya existe un cliente con ese documento (${dup.name})`);
    }
    return this.prisma.customer.update({
      where: { id },
      data: { ...data, ...(input.isActive !== undefined && { isActive: input.isActive }) },
    });
  }

  /** Baja lógica — preserva historial de cotizaciones/crédito. */
  async deactivate(tenantId: string, id: string) {
    await this.get(tenantId, id);
    return this.prisma.customer.update({ where: { id }, data: { isActive: false } });
  }
}
