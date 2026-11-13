import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import {
  Prisma,
  PaymentMethod,
  CreditFrequency,
  CreditStatus,
  InstallmentStatus,
  NcfType,
} from '@prisma/client';
import { montoEnLetras } from '../../common/number-to-words.util';

export interface CreditCheckoutDto {
  customerId: string;
  items: { productId: string; quantity: number; unitPrice?: number; isLoose?: boolean }[];
  downPayment?: number;
  installmentsCount: number;
  frequency?: CreditFrequency;
  firstDueDate: string;
  lateFeePercent?: number;
  ncfType?: NcfType;
  clientRnc?: string;
  applyItbis?: boolean;
  discountAmount?: number;
  notaryInfo?: string;
}

export interface CreditPaymentDto {
  amount: number;
  method?: PaymentMethod;
  note?: string;
}

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

const CREDIT_INCLUDE = {
  customer: { select: { id: true, name: true, docType: true, docNumber: true, phone: true, address: true } },
  installments: { orderBy: { number: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' } },
  promissoryNote: true,
  sale: { select: { id: true, invoiceNumber: true, ncf: true, total: true, createdAt: true } },
} satisfies Prisma.CreditSaleInclude;

@Injectable()
export class CreditService {
  constructor(
    private prisma: PrismaService,
    private salesService: SalesService,
  ) {}

  private addPeriod(base: Date, freq: CreditFrequency, n: number): Date {
    const d = new Date(base);
    if (freq === CreditFrequency.WEEKLY) d.setDate(d.getDate() + 7 * n);
    else if (freq === CreditFrequency.BIWEEKLY) d.setDate(d.getDate() + 14 * n);
    else d.setMonth(d.getMonth() + n);
    return d;
  }

  /** Reparte `financed` en `count` cuotas (2 decimales); la última absorbe el redondeo. */
  private buildSchedule(financed: Prisma.Decimal, count: number, first: Date, freq: CreditFrequency) {
    const base = financed.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const rows: { number: number; dueDate: Date; amount: Prisma.Decimal; paidAmount: Prisma.Decimal; status: InstallmentStatus }[] = [];
    let acc = D(0);
    for (let i = 1; i <= count; i++) {
      const amount = i === count ? financed.sub(acc) : base;
      acc = acc.add(amount);
      rows.push({
        number: i,
        dueDate: this.addPeriod(first, freq, i - 1),
        amount,
        paidAmount: D(0),
        status: InstallmentStatus.PENDING,
      });
    }
    return rows;
  }

  async creditCheckout(tenantId: string, userId: string, dto: CreditCheckoutDto) {
    if (!dto.customerId) throw new BadRequestException('Selecciona un cliente para vender a crédito');
    if (!dto.installmentsCount || dto.installmentsCount < 1) {
      throw new BadRequestException('Indica el número de cuotas');
    }
    if (!dto.firstDueDate) throw new BadRequestException('Indica la fecha de la primera cuota');

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, tenantId, isActive: true },
    });
    if (!customer) throw new BadRequestException('Cliente inválido o inactivo');

    const openSession = await this.prisma.cashSession.findFirst({
      where: { tenantId, userId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!openSession) {
      throw new BadRequestException('No hay una caja abierta. Realiza la Apertura de Caja primero.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const { sale } = await this.salesService.processSale(
        tx,
        tenantId,
        {
          items: dto.items,
          cashReceived: 0,
          ncfType: dto.ncfType ?? NcfType.CONSUMIDOR_FINAL,
          applyItbis: dto.applyItbis,
          clientRnc: dto.clientRnc,
          clientName: customer.name,
          paymentMethod: PaymentMethod.CREDIT,
          discountAmount: dto.discountAmount,
        },
        { cashSessionId: openSession.id },
      );

      const principal = D(sale.total);
      const downPayment = D(dto.downPayment ?? 0);
      if (downPayment.gt(principal)) {
        throw new BadRequestException('El inicial no puede ser mayor que el total');
      }
      const financed = principal.sub(downPayment);

      // Límite de crédito (si está configurado > 0).
      const limit = D(customer.creditLimit);
      if (limit.gt(0) && D(customer.balance).add(financed).gt(limit)) {
        throw new BadRequestException(
          `Excede el límite de crédito del cliente (límite RD$ ${limit.toFixed(2)}, saldo actual RD$ ${D(customer.balance).toFixed(2)})`,
        );
      }

      const firstDue = new Date(dto.firstDueDate);
      const freq = dto.frequency ?? CreditFrequency.MONTHLY;
      const schedule = this.buildSchedule(financed, dto.installmentsCount, firstDue, freq);

      const credit = await tx.creditSale.create({
        data: {
          tenantId,
          saleId: sale.id,
          customerId: customer.id,
          principal,
          downPayment,
          financedAmount: financed,
          installmentsCount: dto.installmentsCount,
          frequency: freq,
          firstDueDate: firstDue,
          lateFeePercent: D(dto.lateFeePercent ?? 0),
          balance: financed,
          status: CreditStatus.OPEN,
          createdById: userId,
          installments: { create: schedule },
        },
      });

      // Inicial: abono + inflow de caja.
      if (downPayment.gt(0)) {
        await tx.creditPayment.create({
          data: {
            tenantId,
            creditSaleId: credit.id,
            amount: downPayment,
            method: PaymentMethod.CASH,
            isDownPayment: true,
            receivedById: userId,
            cashSessionId: openSession.id,
            note: 'Inicial de venta a crédito',
          },
        });
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            tenantId,
            type: 'INFLOW',
            amount: Number(downPayment),
            reason: `Inicial crédito ${sale.invoiceNumber ?? ''}`.trim(),
          },
        });
      }

      // Saldo del cliente sube por lo financiado.
      await tx.customer.update({
        where: { id: customer.id },
        data: { balance: { increment: financed } },
      });

      // Pagaré notarial.
      const noteRows = await tx.$queryRaw<{ n: number }[]>`
        UPDATE "Tenant" SET "promissoryCounter" = "promissoryCounter" + 1
        WHERE id = ${tenantId} RETURNING "promissoryCounter" AS n`;
      const noteNumber = `PG-${new Date().getFullYear()}-${String(noteRows[0].n).padStart(5, '0')}`;
      const legalText =
        `Por este PAGARÉ NOTARIAL, yo, ${customer.name}` +
        `${customer.docNumber ? `, portador(a) del documento ${customer.docType} ${customer.docNumber}` : ''}` +
        `${customer.address ? `, domiciliado(a) en ${customer.address}` : ''}, ` +
        `reconozco deber y me obligo a pagar la suma de RD$ ${financed.toFixed(2)} ` +
        `(${montoEnLetras(Number(financed))}), en ${dto.installmentsCount} cuota(s) ` +
        `${freq === 'WEEKLY' ? 'semanal(es)' : freq === 'BIWEEKLY' ? 'quincenal(es)' : 'mensual(es)'}, ` +
        `iniciando el ${firstDue.toLocaleDateString('es-DO')}.` +
        (Number(dto.lateFeePercent ?? 0) > 0
          ? ` En caso de mora se aplicará un recargo del ${dto.lateFeePercent}% sobre la cuota vencida.`
          : '');

      await tx.promissoryNote.create({
        data: {
          creditSaleId: credit.id,
          number: noteNumber,
          debtorSnapshot: {
            name: customer.name,
            docType: customer.docType,
            docNumber: customer.docNumber,
            address: customer.address,
            phone: customer.phone,
          },
          amount: financed,
          amountInWords: montoEnLetras(Number(financed)),
          legalText,
          notaryInfo: dto.notaryInfo ?? null,
        },
      });

      return { sale, creditId: credit.id };
    });

    this.salesService.enqueueEcfSafe(result.sale);
    return this.getCreditSale(tenantId, result.creditId);
  }

  /** Marca cuotas vencidas y el crédito OVERDUE (perezoso). */
  private async refreshOverdue(tenantId: string, creditSaleId?: string) {
    const now = new Date();
    await this.prisma.installment.updateMany({
      where: {
        dueDate: { lt: now },
        status: { in: [InstallmentStatus.PENDING, InstallmentStatus.PARTIAL] },
        creditSale: { tenantId, ...(creditSaleId ? { id: creditSaleId } : {}) },
      },
      data: { status: InstallmentStatus.OVERDUE },
    });
    // Créditos con alguna cuota OVERDUE y saldo > 0 pasan a OVERDUE.
    const overdueCredits = await this.prisma.creditSale.findMany({
      where: {
        tenantId,
        status: CreditStatus.OPEN,
        ...(creditSaleId ? { id: creditSaleId } : {}),
        installments: { some: { status: InstallmentStatus.OVERDUE } },
      },
      select: { id: true },
    });
    if (overdueCredits.length) {
      await this.prisma.creditSale.updateMany({
        where: { id: { in: overdueCredits.map((c) => c.id) } },
        data: { status: CreditStatus.OVERDUE },
      });
    }
  }

  async listReceivables(tenantId: string, opts?: { status?: string; customerId?: string; search?: string }) {
    await this.refreshOverdue(tenantId);
    const where: Prisma.CreditSaleWhereInput = { tenantId };
    if (opts?.status && opts.status !== 'ALL') where.status = opts.status as CreditStatus;
    if (opts?.customerId) where.customerId = opts.customerId;
    const term = opts?.search?.trim();
    if (term) where.customer = { name: { contains: term, mode: 'insensitive' } };
    return this.prisma.creditSale.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        sale: { select: { invoiceNumber: true, ncf: true, createdAt: true } },
        installments: { select: { dueDate: true, status: true }, orderBy: { number: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getCreditSale(tenantId: string, id: string) {
    await this.refreshOverdue(tenantId, id);
    const credit = await this.prisma.creditSale.findFirst({ where: { id, tenantId }, include: CREDIT_INCLUDE });
    if (!credit) throw new NotFoundException('Crédito no encontrado');
    return credit;
  }

  async registerPayment(tenantId: string, id: string, userId: string, dto: CreditPaymentDto) {
    const amount = D(dto.amount ?? 0);
    if (amount.lte(0)) throw new BadRequestException('El monto del abono debe ser mayor que cero');

    const credit = await this.prisma.creditSale.findFirst({ where: { id, tenantId } });
    if (!credit) throw new NotFoundException('Crédito no encontrado');
    if (credit.status === CreditStatus.PAID) throw new BadRequestException('Este crédito ya está saldado');
    if (credit.status === CreditStatus.CANCELLED) throw new BadRequestException('Este crédito está cancelado');
    if (amount.gt(D(credit.balance))) {
      throw new BadRequestException(`El abono excede el saldo pendiente (RD$ ${D(credit.balance).toFixed(2)})`);
    }

    const method = dto.method ?? PaymentMethod.CASH;
    let cashSessionId: string | null = null;
    if (method === PaymentMethod.CASH) {
      const session = await this.prisma.cashSession.findFirst({
        where: { tenantId, userId, status: 'OPEN' },
        orderBy: { openedAt: 'desc' },
      });
      if (!session) throw new BadRequestException('Abre la caja para registrar un abono en efectivo');
      cashSessionId = session.id;
    }

    return this.prisma.$transaction(async (tx) => {
      // FIFO sobre cuotas no saldadas.
      const installments = await tx.installment.findMany({
        where: { creditSaleId: id, status: { not: InstallmentStatus.PAID } },
        orderBy: { number: 'asc' },
      });
      let remaining = amount;
      for (const inst of installments) {
        if (remaining.lte(0)) break;
        const due = D(inst.amount).sub(D(inst.paidAmount));
        const applied = Prisma.Decimal.min(due, remaining);
        const newPaid = D(inst.paidAmount).add(applied);
        const paidFull = newPaid.gte(D(inst.amount));
        await tx.installment.update({
          where: { id: inst.id },
          data: {
            paidAmount: newPaid,
            status: paidFull ? InstallmentStatus.PAID : InstallmentStatus.PARTIAL,
          },
        });
        remaining = remaining.sub(applied);
      }

      await tx.creditPayment.create({
        data: {
          tenantId,
          creditSaleId: id,
          amount,
          method,
          receivedById: userId,
          cashSessionId,
          note: dto.note?.trim() || null,
        },
      });
      if (cashSessionId) {
        await tx.cashMovement.create({
          data: {
            cashSessionId,
            tenantId,
            type: 'INFLOW',
            amount: Number(amount),
            reason: `Abono crédito ${credit.id.slice(0, 8)}`,
          },
        });
      }

      const newBalance = D(credit.balance).sub(amount);
      const paidOff = newBalance.lte(0);
      await tx.creditSale.update({
        where: { id },
        data: { balance: newBalance, status: paidOff ? CreditStatus.PAID : CreditStatus.OPEN },
      });
      await tx.customer.update({
        where: { id: credit.customerId },
        data: { balance: { decrement: amount } },
      });

      return tx.creditSale.findUnique({ where: { id }, include: CREDIT_INCLUDE });
    });
  }

  async dashboard(tenantId: string) {
    await this.refreshOverdue(tenantId);
    const [agg, overdueAgg, counts] = await Promise.all([
      this.prisma.creditSale.aggregate({
        where: { tenantId, status: { in: [CreditStatus.OPEN, CreditStatus.OVERDUE] } },
        _sum: { balance: true },
      }),
      this.prisma.creditSale.aggregate({
        where: { tenantId, status: CreditStatus.OVERDUE },
        _sum: { balance: true },
      }),
      this.prisma.creditSale.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c._count;
    return {
      porCobrar: Number(agg._sum.balance ?? 0),
      vencido: Number(overdueAgg._sum.balance ?? 0),
      cuentas: byStatus,
    };
  }
}
