import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Prisma,
  PaymentMethod,
  SupplierInvoiceStatus,
  StockMovementType,
} from '@prisma/client';
import { AuditService, AuditActor } from '../../common/audit.module';
import { buildSpreadsheet, readTabular, type SheetColumn } from '../../common/spreadsheet.util';
import { parseXpsToRows } from '../../common/xps-parser.util';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

export interface SupplierDto {
  name: string;
  rnc?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface SupplierInvoiceItemDto {
  productId?: string | null;
  rawName: string;
  quantity: number;
  unitCost: number;
}

export interface CreateInvoiceDto {
  supplierId: string;
  invoiceNumber: string;
  ncf?: string | null;
  date: string;
  dueDate?: string | null;
  applyItbis?: boolean;
  items: SupplierInvoiceItemDto[];
  notes?: string | null;
  sourceFileUrl?: string | null;
}

export interface SupplierPaymentDto {
  amount: number;
  method?: PaymentMethod;
  note?: string;
}

const INVOICE_INCLUDE = {
  supplier: { select: { id: true, name: true, rnc: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
  },
  payments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.SupplierInvoiceInclude;

@Injectable()
export class PurchasingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─────────────────────────── Proveedores ───────────────────────────

  listSuppliers(tenantId: string, search?: string, activeOnly?: boolean) {
    return this.prisma.supplier.findMany({
      where: {
        tenantId,
        ...(activeOnly ? { active: true } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { rnc: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async getSupplier(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        invoices: {
          orderBy: { date: 'desc' },
          take: 50,
          select: {
            id: true,
            invoiceNumber: true,
            ncf: true,
            date: true,
            total: true,
            balance: true,
            status: true,
          },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  async createSupplier(tenantId: string, dto: SupplierDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('El nombre del proveedor es obligatorio');
    const rnc = dto.rnc?.trim() || null;
    if (rnc) {
      const clash = await this.prisma.supplier.findFirst({ where: { tenantId, rnc } });
      if (clash) throw new BadRequestException('Ya existe un proveedor con ese RNC');
    }
    return this.prisma.supplier.create({
      data: {
        tenantId,
        name,
        rnc,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        address: dto.address?.trim() || null,
        notes: dto.notes?.trim() || null,
        active: dto.active ?? true,
      },
    });
  }

  async updateSupplier(tenantId: string, id: string, dto: Partial<SupplierDto>) {
    const existing = await this.prisma.supplier.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Proveedor no encontrado');
    const rnc = dto.rnc !== undefined ? dto.rnc?.trim() || null : existing.rnc;
    if (rnc && rnc !== existing.rnc) {
      const clash = await this.prisma.supplier.findFirst({ where: { tenantId, rnc, id: { not: id } } });
      if (clash) throw new BadRequestException('Ya existe un proveedor con ese RNC');
    }
    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.rnc !== undefined ? { rnc } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  // ─────────────────────────── Facturas de compra ───────────────────────────

  async listInvoices(
    tenantId: string,
    opts: { supplierId?: string; status?: string; search?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
    const where: Prisma.SupplierInvoiceWhereInput = {
      tenantId,
      ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
      ...(opts.status ? { status: opts.status as SupplierInvoiceStatus } : {}),
      ...(opts.search
        ? {
            OR: [
              { invoiceNumber: { contains: opts.search, mode: 'insensitive' } },
              { ncf: { contains: opts.search, mode: 'insensitive' } },
              { supplier: { name: { contains: opts.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.supplierInvoice.count({ where }),
      this.prisma.supplierInvoice.findMany({
        where,
        include: { supplier: { select: { id: true, name: true, rnc: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  async getInvoice(tenantId: string, id: string) {
    const invoice = await this.prisma.supplierInvoice.findFirst({
      where: { id, tenantId },
      include: INVOICE_INCLUDE,
    });
    if (!invoice) throw new NotFoundException('Factura de compra no encontrada');
    return invoice;
  }

  /**
   * Crea la factura de compra con sus líneas, sube el balance del proveedor y,
   * por cada línea con producto vinculado, incrementa el stock y registra un
   * StockMovement de auditoría. Todo en una transacción.
   */
  async createInvoice(tenantId: string, userId: string, dto: CreateInvoiceDto, actor: AuditActor) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, tenantId } });
    if (!supplier) throw new BadRequestException('Proveedor no válido');
    const invoiceNumber = dto.invoiceNumber?.trim();
    if (!invoiceNumber) throw new BadRequestException('El número de factura es obligatorio');
    const items = (dto.items ?? []).filter((it) => it.rawName?.trim() && it.quantity > 0);
    if (items.length === 0) throw new BadRequestException('La factura debe tener al menos una línea válida');

    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Fecha inválida');
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

    // Validar que los productos referenciados pertenezcan al tenant.
    const productIds = [...new Set(items.map((it) => it.productId).filter(Boolean) as string[])];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { tenantId, id: { in: productIds } }, select: { id: true, stock: true } })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const id of productIds) {
      if (!productMap.has(id)) throw new BadRequestException('Una línea referencia un producto que no existe');
    }

    let subtotal = D(0);
    const lineData = items.map((it) => {
      const lineTotal = D(it.unitCost).mul(it.quantity);
      subtotal = subtotal.add(lineTotal);
      return {
        productId: it.productId || null,
        rawName: it.rawName.trim(),
        quantity: it.quantity,
        unitCost: D(it.unitCost),
        total: lineTotal,
      };
    });
    const itbis = dto.applyItbis ? subtotal.mul(0.18) : D(0);
    const total = subtotal.add(itbis);

    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.supplierInvoice.create({
        data: {
          tenantId,
          supplierId: dto.supplierId,
          invoiceNumber,
          ncf: dto.ncf?.trim() || null,
          date,
          dueDate,
          subtotal,
          itbis,
          total,
          balance: total,
          status: SupplierInvoiceStatus.PENDING,
          sourceFileUrl: dto.sourceFileUrl?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          items: { create: lineData },
        },
        include: INVOICE_INCLUDE,
      });

      // Subir stock + auditar por cada línea vinculada a un producto.
      for (const it of items) {
        if (!it.productId) continue;
        const current = productMap.get(it.productId)!;
        const resultingStock = current.stock + Math.round(it.quantity);
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: resultingStock, cost: it.unitCost },
        });
        await tx.stockMovement.create({
          data: {
            tenantId,
            productId: it.productId,
            type: StockMovementType.PURCHASE_RECEIPT,
            quantityDelta: it.quantity,
            resultingStock,
            referenceType: 'SupplierInvoice',
            referenceId: invoice.id,
            createdById: userId,
          },
        });
        // Mantener el mapa consistente si el mismo producto aparece dos veces.
        current.stock = resultingStock;
      }

      await tx.supplier.update({
        where: { id: dto.supplierId },
        data: { balance: { increment: total } },
      });

      this.audit.log(actor, 'SUPPLIER_INVOICE_CREATE', tenantId, {
        invoiceId: invoice.id,
        supplierId: dto.supplierId,
        total: total.toFixed(2),
        items: items.length,
      });
      return invoice;
    });
  }

  /**
   * Registra un abono a una factura de compra. Reduce el balance de la factura y
   * del proveedor; marca PAID cuando llega a 0, PARTIAL si queda saldo.
   * Mismo patrón que CreditService.registerPayment.
   */
  async registerPayment(tenantId: string, invoiceId: string, userId: string, dto: SupplierPaymentDto, actor: AuditActor) {
    const amount = D(dto.amount ?? 0);
    if (amount.lte(0)) throw new BadRequestException('El monto del pago debe ser mayor que cero');

    const invoice = await this.prisma.supplierInvoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('Factura de compra no encontrada');
    if (invoice.status === SupplierInvoiceStatus.PAID) throw new BadRequestException('Esta factura ya está saldada');
    if (amount.gt(D(invoice.balance))) {
      throw new BadRequestException(`El pago excede el saldo pendiente (RD$ ${D(invoice.balance).toFixed(2)})`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.supplierPayment.create({
        data: {
          tenantId,
          supplierInvoiceId: invoiceId,
          amount,
          method: dto.method ?? PaymentMethod.CASH,
          note: dto.note?.trim() || null,
          createdById: userId,
        },
      });
      const newBalance = D(invoice.balance).sub(amount);
      const paidOff = newBalance.lte(0);
      const partial = !paidOff && newBalance.lt(D(invoice.total));
      await tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: {
          balance: newBalance,
          status: paidOff
            ? SupplierInvoiceStatus.PAID
            : partial
              ? SupplierInvoiceStatus.PARTIAL
              : SupplierInvoiceStatus.PENDING,
        },
      });
      await tx.supplier.update({
        where: { id: invoice.supplierId },
        data: { balance: { decrement: amount } },
      });
      this.audit.log(actor, 'SUPPLIER_PAYMENT', tenantId, {
        invoiceId,
        amount: amount.toFixed(2),
        paidOff,
      });
      return tx.supplierInvoice.findUnique({ where: { id: invoiceId }, include: INVOICE_INCLUDE });
    });
  }

  // ─────────────── Importar factura (CSV / Excel / XPS) → preview ───────────────

  /** Paso 1: lee el archivo a filas y sugiere mapeo de columnas (sin tocar la BD). */
  async parseInvoiceFile(buffer: Buffer, filename: string) {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    let rows: string[][];
    let source: 'csv' | 'xlsx' | 'xps';
    let hasHeaderRow: boolean;

    if (ext === 'xps') {
      rows = await parseXpsToRows(buffer);
      source = 'xps';
      hasHeaderRow = false;
    } else if (ext === 'xlsx' || ext === 'xls') {
      rows = await readTabular(buffer, 'xlsx');
      source = 'xlsx';
      hasHeaderRow = true;
    } else if (ext === 'csv' || ext === 'txt') {
      rows = await readTabular(buffer, 'csv');
      source = 'csv';
      hasHeaderRow = true;
    } else {
      throw new BadRequestException('Formato no soportado. Usa CSV, Excel (.xlsx) o XPS.');
    }

    rows = rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
    if (rows.length === 0) throw new BadRequestException('El archivo está vacío o no se pudo leer.');

    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows = rows.map((r) => {
      const copy = r.slice(0, width);
      while (copy.length < width) copy.push('');
      return copy;
    });

    const suggestedMapping = hasHeaderRow ? rows[0].map((h) => guessInvoiceField(h)) : new Array(width).fill('');

    return {
      source,
      hasHeaderRow,
      rows: rows.slice(0, 500),
      totalRows: rows.length,
      suggestedMapping,
      fields: INVOICE_IMPORT_FIELDS,
    };
  }

  /**
   * Paso 2 (preview, sin BD): convierte las filas mapeadas en líneas de factura y,
   * por nombre, sugiere a qué producto existente corresponde cada una. El usuario
   * revisa/corrige y luego llama a createInvoice con las líneas confirmadas.
   */
  async matchInvoiceLines(
    tenantId: string,
    dto: { rows: string[][]; mapping: string[]; hasHeaderRow?: boolean },
  ) {
    const mapping = dto.mapping ?? [];
    const colOf = (field: string) => mapping.findIndex((f) => f === field);
    if (colOf('name') < 0) throw new BadRequestException('Debes mapear al menos la columna «Descripción».');

    let dataRows = dto.rows ?? [];
    if (dto.hasHeaderRow) dataRows = dataRows.slice(1);
    const get = (row: string[], field: string): string => {
      const i = colOf(field);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };

    const products = await this.prisma.product.findMany({
      where: { tenantId },
      select: { id: true, name: true, barcode: true, sku: true },
    });
    const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!.toLowerCase(), p]));
    const bySku = new Map(products.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
    const byName = new Map(products.map((p) => [normalize(p.name), p]));

    const lines = dataRows
      .map((row) => {
        const rawName = get(row, 'name');
        if (!rawName) return null;
        const quantity = parseNumber(get(row, 'quantity')) || 1;
        const unitCost = parseNumber(get(row, 'unitCost'));
        const barcode = get(row, 'barcode');
        const match =
          (barcode && byBarcode.get(barcode.toLowerCase())) ||
          byName.get(normalize(rawName)) ||
          bySku.get(rawName.toLowerCase()) ||
          null;
        return {
          rawName,
          quantity,
          unitCost,
          productId: match?.id ?? null,
          matchedName: match?.name ?? null,
        };
      })
      .filter(Boolean);

    return { lines, fields: INVOICE_IMPORT_FIELDS };
  }

  // ─────────────────────────── Dashboard / reportes ───────────────────────────

  async dashboard(tenantId: string) {
    const [payable, suppliersCount, overdue, recent] = await Promise.all([
      this.prisma.supplier.aggregate({ where: { tenantId }, _sum: { balance: true } }),
      this.prisma.supplier.count({ where: { tenantId, active: true } }),
      this.prisma.supplierInvoice.aggregate({
        where: { tenantId, status: { not: SupplierInvoiceStatus.PAID }, dueDate: { lt: new Date() } },
        _sum: { balance: true },
      }),
      this.prisma.supplierInvoice.findMany({
        where: { tenantId },
        include: { supplier: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 10,
      }),
    ]);
    return {
      totalPayable: D(payable._sum.balance ?? 0).toFixed(2),
      overduePayable: D(overdue._sum.balance ?? 0).toFixed(2),
      activeSuppliers: suppliersCount,
      recentInvoices: recent,
    };
  }

  async exportSuppliers(tenantId: string, format: 'csv' | 'xlsx'): Promise<Buffer> {
    const suppliers = await this.prisma.supplier.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    const rows = suppliers.map((s) => ({
      name: s.name,
      rnc: s.rnc ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      balance: Number(s.balance),
    }));
    return buildSpreadsheet(format, 'Proveedores', SUPPLIER_EXPORT_COLUMNS, rows);
  }
}

const SUPPLIER_EXPORT_COLUMNS: SheetColumn[] = [
  { header: 'Proveedor', key: 'name', width: 34 },
  { header: 'RNC', key: 'rnc', width: 16 },
  { header: 'Teléfono', key: 'phone', width: 16 },
  { header: 'Email', key: 'email', width: 24 },
  { header: 'Saldo por pagar', key: 'balance', width: 16 },
];

export const INVOICE_IMPORT_FIELDS = [
  { value: 'name', label: 'Descripción / Producto' },
  { value: 'quantity', label: 'Cantidad' },
  { value: 'unitCost', label: 'Costo unitario' },
  { value: 'barcode', label: 'Código de barra' },
];

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessInvoiceField(header: string): string {
  const h = normalize(header);
  const has = (...keys: string[]) => keys.some((k) => h.includes(k));
  if (has('barra', 'barcode', 'ean', 'upc')) return 'barcode';
  if (has('cantidad', 'cant', 'qty', 'unidades')) return 'quantity';
  if (has('costo', 'precio', 'cost', 'price', 'importe', 'valor')) return 'unitCost';
  if (has('descripcion', 'producto', 'articulo', 'detalle', 'item', 'concepto', 'nombre')) return 'name';
  return '';
}

function parseNumber(v: string): number {
  if (!v) return 0;
  let s = String(v).replace(/[^0-9.,-]/g, '').trim();
  if (!s) return 0;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
