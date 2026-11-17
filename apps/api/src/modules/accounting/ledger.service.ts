import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditActor } from '../../common/audit.module';
import { Prisma, AccountType, JournalSourceType } from '@prisma/client';
import { buildSpreadsheet, readTabular, type SheetColumn } from '../../common/spreadsheet.util';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

/** Catálogo de cuentas por defecto (pequeño comercio RD) + rol de auto-posting. */
const DEFAULT_COA: { code: string; name: string; type: AccountType; role?: string }[] = [
  { code: '1101', name: 'Caja', type: 'ASSET', role: 'CASH' },
  { code: '1102', name: 'Bancos', type: 'ASSET', role: 'BANK' },
  { code: '1103', name: 'Cuentas por cobrar', type: 'ASSET', role: 'AR' },
  { code: '1104', name: 'Inventario', type: 'ASSET', role: 'INVENTORY' },
  { code: '1105', name: 'ITBIS adelantado (pagado)', type: 'ASSET', role: 'ITBIS_PAID' },
  { code: '2101', name: 'Cuentas por pagar (proveedores)', type: 'LIABILITY', role: 'AP' },
  { code: '2102', name: 'ITBIS por pagar (cobrado)', type: 'LIABILITY', role: 'ITBIS_PAYABLE' },
  { code: '3101', name: 'Capital', type: 'EQUITY', role: 'EQUITY' },
  { code: '4101', name: 'Ingresos por ventas', type: 'INCOME', role: 'SALES_INCOME' },
  { code: '5101', name: 'Costo de ventas', type: 'EXPENSE', role: 'COGS' },
  { code: '5201', name: 'Gastos generales', type: 'EXPENSE', role: 'EXPENSE' },
];

const ACCOUNT_IMPORT_FIELDS = [
  { value: 'code', label: 'Código' },
  { value: 'name', label: 'Nombre' },
  { value: 'type', label: 'Tipo (ASSET/LIABILITY/EQUITY/INCOME/EXPENSE)' },
];

const TYPE_ALIASES: Record<string, AccountType> = {
  activo: 'ASSET', asset: 'ASSET', activos: 'ASSET',
  pasivo: 'LIABILITY', liability: 'LIABILITY', pasivos: 'LIABILITY',
  capital: 'EQUITY', patrimonio: 'EQUITY', equity: 'EQUITY',
  ingreso: 'INCOME', ingresos: 'INCOME', income: 'INCOME',
  gasto: 'EXPENSE', gastos: 'EXPENSE', expense: 'EXPENSE', costo: 'EXPENSE',
};

interface JournalLineInput { accountId: string; debit?: number; credit?: number }

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ─────────────────────── Catálogo de cuentas ───────────────────────

  /** Siembra el catálogo por defecto + mapeo si el tenant aún no tiene cuentas. */
  async ensureDefaults(tenantId: string) {
    const count = await this.prisma.account.count({ where: { tenantId } });
    if (count > 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const a of DEFAULT_COA) {
        const acc = await tx.account.create({
          data: { tenantId, code: a.code, name: a.name, type: a.type },
        });
        if (a.role) {
          await tx.accountMapping.create({ data: { tenantId, role: a.role, accountId: acc.id } });
        }
      }
    });
  }

  async listAccounts(tenantId: string) {
    await this.ensureDefaults(tenantId);
    return this.prisma.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  async createAccount(tenantId: string, dto: { code: string; name: string; type: AccountType; parentId?: string | null }) {
    const code = dto.code?.trim();
    const name = dto.name?.trim();
    if (!code || !name) throw new BadRequestException('Código y nombre son obligatorios');
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].includes(dto.type)) {
      throw new BadRequestException('Tipo de cuenta inválido');
    }
    const clash = await this.prisma.account.findFirst({ where: { tenantId, code } });
    if (clash) throw new ConflictException('Ya existe una cuenta con ese código');
    return this.prisma.account.create({
      data: { tenantId, code, name, type: dto.type, parentId: dto.parentId || null },
    });
  }

  async updateAccount(tenantId: string, id: string, dto: { name?: string; active?: boolean }) {
    const acc = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!acc) throw new NotFoundException('Cuenta no encontrada');
    return this.prisma.account.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  /** Mapeo rol → cuenta (para configurar el auto-posting). */
  async getMappings(tenantId: string) {
    await this.ensureDefaults(tenantId);
    return this.prisma.accountMapping.findMany({ where: { tenantId } });
  }

  async setMapping(tenantId: string, role: string, accountId: string) {
    const acc = await this.prisma.account.findFirst({ where: { id: accountId, tenantId } });
    if (!acc) throw new BadRequestException('Cuenta no válida');
    return this.prisma.accountMapping.upsert({
      where: { tenantId_role: { tenantId, role } },
      update: { accountId },
      create: { tenantId, role, accountId },
    });
  }

  // ─────────────────────── Importar catálogo ───────────────────────

  async parseAccountsFile(buffer: Buffer, filename: string) {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    if (!['csv', 'txt', 'xlsx', 'xls'].includes(ext)) {
      throw new BadRequestException('Formato no soportado. Usa CSV o Excel (.xlsx).');
    }
    let rows = await readTabular(buffer, ext === 'xlsx' || ext === 'xls' ? 'xlsx' : 'csv');
    rows = rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
    if (rows.length === 0) throw new BadRequestException('El archivo está vacío.');
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows = rows.map((r) => { const c = r.slice(0, width); while (c.length < width) c.push(''); return c; });
    const suggestedMapping = rows[0].map((h) => guessAccountField(h));
    return { source: ext, hasHeaderRow: true, rows: rows.slice(0, 500), totalRows: rows.length, suggestedMapping, fields: ACCOUNT_IMPORT_FIELDS };
  }

  async commitAccountsImport(tenantId: string, dto: { rows: string[][]; mapping: string[]; hasHeaderRow?: boolean }) {
    const mapping = dto.mapping ?? [];
    const colOf = (f: string) => mapping.findIndex((m) => m === f);
    if (colOf('code') < 0 || colOf('name') < 0) throw new BadRequestException('Mapea al menos Código y Nombre.');
    let dataRows = dto.rows ?? [];
    if (dto.hasHeaderRow) dataRows = dataRows.slice(1);
    const get = (row: string[], f: string) => { const i = colOf(f); return i >= 0 ? (row[i] ?? '').trim() : ''; };

    const existing = await this.prisma.account.findMany({ where: { tenantId }, select: { code: true } });
    const existingCodes = new Set(existing.map((e) => e.code));
    let created = 0, skipped = 0;
    const errors: { row: number; code: string; reason: string }[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const code = get(dataRows[i], 'code');
      const name = get(dataRows[i], 'name');
      if (!code || !name) { skipped++; continue; }
      if (existingCodes.has(code)) { skipped++; continue; }
      const type = normalizeType(get(dataRows[i], 'type'));
      if (!type) { errors.push({ row: i + 1, code, reason: 'Tipo inválido' }); continue; }
      try {
        await this.prisma.account.create({ data: { tenantId, code, name, type } });
        existingCodes.add(code);
        created++;
      } catch (e) { errors.push({ row: i + 1, code, reason: e instanceof Error ? e.message : 'Error' }); }
    }
    return { created, skipped, errorCount: errors.length, errors: errors.slice(0, 50) };
  }

  // ─────────────────────── Asientos de diario ───────────────────────

  private async assertPeriodOpen(tenantId: string, date: Date) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { tenantId_year_month: { tenantId, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 } },
    });
    if (period && period.status !== 'OPEN') {
      throw new ConflictException(`El período ${period.year}-${String(period.month).padStart(2, '0')} está cerrado`);
    }
  }

  async createManualEntry(
    tenantId: string,
    userId: string,
    dto: { date: string; memo?: string; lines: JournalLineInput[] },
    actor: AuditActor,
  ) {
    if (!dto.date) throw new BadRequestException('La fecha es obligatoria');
    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Fecha inválida');
    await this.assertPeriodOpen(tenantId, date);

    const lines = (dto.lines ?? []).filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
    if (lines.length < 2) throw new BadRequestException('Un asiento necesita al menos 2 líneas');
    let totalDebit = D(0), totalCredit = D(0);
    for (const l of lines) {
      if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) {
        throw new BadRequestException('Cada línea es débito o crédito, no ambos');
      }
      totalDebit = totalDebit.add(l.debit ?? 0);
      totalCredit = totalCredit.add(l.credit ?? 0);
    }
    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(`El asiento no cuadra: débitos RD$ ${totalDebit.toFixed(2)} ≠ créditos RD$ ${totalCredit.toFixed(2)}`);
    }
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.account.findMany({ where: { tenantId, id: { in: accountIds } }, select: { id: true } });
    if (accounts.length !== accountIds.length) throw new BadRequestException('Una línea referencia una cuenta inválida');

    const entry = await this.prisma.journalEntry.create({
      data: {
        tenantId, date, memo: dto.memo?.trim() || null,
        sourceType: JournalSourceType.MANUAL, createdById: userId,
        lines: { create: lines.map((l) => ({ accountId: l.accountId, debit: D(l.debit ?? 0), credit: D(l.credit ?? 0) })) },
      },
      include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    });
    this.audit.log(actor, 'JOURNAL_ENTRY_CREATE', tenantId, { entryId: entry.id, total: totalDebit.toFixed(2) });
    return entry;
  }

  async listJournal(tenantId: string, from?: string, to?: string) {
    const where: Prisma.JournalEntryWhereInput = { tenantId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) { const e = new Date(to); e.setHours(23, 59, 59, 999); where.date.lte = e; }
    }
    return this.prisma.journalEntry.findMany({
      where,
      include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } },
      orderBy: { date: 'desc' },
      take: 500,
    });
  }

  /** Libro mayor de una cuenta con saldo corriente. */
  async ledgerForAccount(tenantId: string, accountId: string, from?: string, to?: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new NotFoundException('Cuenta no encontrada');
    const where: Prisma.JournalLineWhereInput = { accountId, journalEntry: { tenantId } };
    if (from || to) {
      where.journalEntry = { tenantId, date: {} };
      const dr = where.journalEntry.date as Prisma.DateTimeFilter;
      if (from) dr.gte = new Date(from);
      if (to) { const e = new Date(to); e.setHours(23, 59, 59, 999); dr.lte = e; }
    }
    const lines = await this.prisma.journalLine.findMany({
      where,
      include: { journalEntry: { select: { id: true, date: true, memo: true, sourceType: true } } },
      orderBy: { journalEntry: { date: 'asc' } },
    });
    const normalDebit = account.type === 'ASSET' || account.type === 'EXPENSE';
    let running = D(0);
    const rows = lines.map((l) => {
      const debit = D(l.debit), credit = D(l.credit);
      running = normalDebit ? running.add(debit).sub(credit) : running.add(credit).sub(debit);
      return {
        entryId: l.journalEntry.id, date: l.journalEntry.date, memo: l.journalEntry.memo,
        sourceType: l.journalEntry.sourceType,
        debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2),
      };
    });
    return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, rows, balance: running.toFixed(2) };
  }

  // ─────────────────────── Auto-posting (idempotente) ───────────────────────

  /**
   * Genera asientos automáticos para ventas y compras del rango que aún no los
   * tengan. Idempotente por (sourceType, sourceId): volver a correrlo no duplica.
   */
  async syncFromSources(tenantId: string, from: string, to: string, actor: AuditActor) {
    await this.ensureDefaults(tenantId);
    const mappings = await this.prisma.accountMapping.findMany({ where: { tenantId } });
    const acc = (role: string) => mappings.find((m) => m.role === role)?.accountId;
    const fromD = new Date(from); const toD = new Date(to); toD.setHours(23, 59, 59, 999);
    if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new BadRequestException('Rango de fechas inválido');

    const existing = await this.prisma.journalEntry.findMany({
      where: { tenantId, sourceType: { in: [JournalSourceType.SALE, JournalSourceType.PURCHASE, JournalSourceType.SUPPLIER_PAYMENT, JournalSourceType.CREDIT_PAYMENT] } },
      select: { sourceType: true, sourceId: true },
    });
    const done = new Set(existing.map((e) => `${e.sourceType}:${e.sourceId}`));
    let salesPosted = 0, purchasesPosted = 0, paymentsPosted = 0;
    const batch: Prisma.JournalEntryCreateManyInput[] = [];
    const lineBatch: Prisma.JournalLineCreateManyInput[] = [];
    const pushEntry = (date: Date, sourceType: JournalSourceType, sourceId: string, memo: string, lines: { accountId?: string; debit?: number; credit?: number }[]) => {
      const valid = lines.filter((l) => l.accountId && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0));
      if (valid.length < 2) return false;
      const id = cryptoRandom();
      batch.push({ id, tenantId, date, memo, sourceType, sourceId });
      for (const l of valid) lineBatch.push({ journalEntryId: id, accountId: l.accountId!, debit: D(l.debit ?? 0), credit: D(l.credit ?? 0) });
      return true;
    };

    // Ventas
    const sales = await this.prisma.sale.findMany({
      where: { tenantId, status: { not: 'VOIDED' }, createdAt: { gte: fromD, lte: toD } },
      include: { items: { select: { quantity: true, cost: true } }, creditSale: { select: { id: true } } },
    });
    for (const s of sales) {
      if (done.has(`SALE:${s.id}`)) continue;
      const total = s.total ?? 0;
      const itbis = s.itbis ?? 0;
      const income = total - itbis;
      const cogs = s.items.reduce((sum, it) => sum + (it.cost ?? 0) * it.quantity, 0);
      const debitAccount = s.creditSale ? acc('AR') : acc('CASH');
      const ok = pushEntry(s.createdAt, JournalSourceType.SALE, s.id, `Venta ${s.invoiceNumber ?? s.id.slice(0, 8)}`, [
        { accountId: debitAccount, debit: total },
        { accountId: acc('SALES_INCOME'), credit: income },
        { accountId: acc('ITBIS_PAYABLE'), credit: itbis },
        ...(cogs > 0 ? [{ accountId: acc('COGS'), debit: cogs }, { accountId: acc('INVENTORY'), credit: cogs }] : []),
      ]);
      if (ok) salesPosted++;
    }

    // Compras (facturas de proveedor)
    const purchases = await this.prisma.supplierInvoice.findMany({
      where: { tenantId, date: { gte: fromD, lte: toD } },
    });
    for (const p of purchases) {
      if (done.has(`PURCHASE:${p.id}`)) continue;
      const ok = pushEntry(p.date, JournalSourceType.PURCHASE, p.id, `Compra ${p.invoiceNumber}`, [
        { accountId: acc('INVENTORY'), debit: Number(p.subtotal) },
        { accountId: acc('ITBIS_PAID'), debit: Number(p.itbis) },
        { accountId: acc('AP'), credit: Number(p.total) },
      ]);
      if (ok) purchasesPosted++;
    }

    // Pagos a proveedores
    const supplierPays = await this.prisma.supplierPayment.findMany({ where: { tenantId, createdAt: { gte: fromD, lte: toD } } });
    for (const pay of supplierPays) {
      if (done.has(`SUPPLIER_PAYMENT:${pay.id}`)) continue;
      const cashAcc = pay.method === 'TRANSFER' ? acc('BANK') : acc('CASH');
      const ok = pushEntry(pay.createdAt, JournalSourceType.SUPPLIER_PAYMENT, pay.id, 'Pago a proveedor', [
        { accountId: acc('AP'), debit: Number(pay.amount) },
        { accountId: cashAcc, credit: Number(pay.amount) },
      ]);
      if (ok) paymentsPosted++;
    }

    // Abonos de clientes (crédito)
    const creditPays = await this.prisma.creditPayment.findMany({ where: { tenantId, createdAt: { gte: fromD, lte: toD } } });
    for (const pay of creditPays) {
      if (done.has(`CREDIT_PAYMENT:${pay.id}`)) continue;
      const cashAcc = pay.method === 'TRANSFER' ? acc('BANK') : acc('CASH');
      const ok = pushEntry(pay.createdAt, JournalSourceType.CREDIT_PAYMENT, pay.id, 'Abono de cliente', [
        { accountId: cashAcc, debit: Number(pay.amount) },
        { accountId: acc('AR'), credit: Number(pay.amount) },
      ]);
      if (ok) paymentsPosted++;
    }

    if (batch.length) {
      await this.prisma.$transaction([
        this.prisma.journalEntry.createMany({ data: batch }),
        this.prisma.journalLine.createMany({ data: lineBatch }),
      ]);
    }
    this.audit.log(actor, 'JOURNAL_SYNC', tenantId, { from, to, salesPosted, purchasesPosted, paymentsPosted });
    return { salesPosted, purchasesPosted, paymentsPosted, totalEntries: batch.length };
  }

  // ─────────────────────── Estados financieros ───────────────────────

  private async balancesByType(tenantId: string, from: Date | null, to: Date) {
    const where: Prisma.JournalLineWhereInput = { journalEntry: { tenantId, date: from ? { gte: from, lte: to } : { lte: to } } };
    const lines = await this.prisma.journalLine.findMany({
      where,
      select: { debit: true, credit: true, account: { select: { id: true, code: true, name: true, type: true } } },
    });
    const map = new Map<string, { code: string; name: string; type: AccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const l of lines) {
      const a = l.account;
      const cur = map.get(a.id) ?? { code: a.code, name: a.name, type: a.type, debit: D(0), credit: D(0) };
      cur.debit = cur.debit.add(l.debit); cur.credit = cur.credit.add(l.credit);
      map.set(a.id, cur);
    }
    return map;
  }

  /** Estado de Resultados (ingresos − gastos) de un rango. */
  async incomeStatement(tenantId: string, from: string, to: string) {
    await this.ensureDefaults(tenantId);
    const toD = new Date(to); toD.setHours(23, 59, 59, 999);
    const map = await this.balancesByType(tenantId, new Date(from), toD);
    const income: { code: string; name: string; amount: string }[] = [];
    const expense: { code: string; name: string; amount: string }[] = [];
    let totalIncome = D(0), totalExpense = D(0);
    for (const a of map.values()) {
      if (a.type === 'INCOME') { const amt = a.credit.sub(a.debit); income.push({ code: a.code, name: a.name, amount: amt.toFixed(2) }); totalIncome = totalIncome.add(amt); }
      else if (a.type === 'EXPENSE') { const amt = a.debit.sub(a.credit); expense.push({ code: a.code, name: a.name, amount: amt.toFixed(2) }); totalExpense = totalExpense.add(amt); }
    }
    income.sort((x, y) => x.code.localeCompare(y.code));
    expense.sort((x, y) => x.code.localeCompare(y.code));
    return {
      from, to, income, expense,
      totalIncome: totalIncome.toFixed(2), totalExpense: totalExpense.toFixed(2),
      netIncome: totalIncome.sub(totalExpense).toFixed(2),
    };
  }

  /** Balance General a una fecha (acumulado desde el inicio). */
  async balanceSheet(tenantId: string, asOf: string) {
    await this.ensureDefaults(tenantId);
    const toD = new Date(asOf); toD.setHours(23, 59, 59, 999);
    const map = await this.balancesByType(tenantId, null, toD);
    const assets: { code: string; name: string; amount: string }[] = [];
    const liabilities: { code: string; name: string; amount: string }[] = [];
    const equity: { code: string; name: string; amount: string }[] = [];
    let totalAssets = D(0), totalLiab = D(0), totalEquity = D(0), totalIncome = D(0), totalExpense = D(0);
    for (const a of map.values()) {
      if (a.type === 'ASSET') { const amt = a.debit.sub(a.credit); assets.push({ code: a.code, name: a.name, amount: amt.toFixed(2) }); totalAssets = totalAssets.add(amt); }
      else if (a.type === 'LIABILITY') { const amt = a.credit.sub(a.debit); liabilities.push({ code: a.code, name: a.name, amount: amt.toFixed(2) }); totalLiab = totalLiab.add(amt); }
      else if (a.type === 'EQUITY') { const amt = a.credit.sub(a.debit); equity.push({ code: a.code, name: a.name, amount: amt.toFixed(2) }); totalEquity = totalEquity.add(amt); }
      else if (a.type === 'INCOME') totalIncome = totalIncome.add(a.credit.sub(a.debit));
      else if (a.type === 'EXPENSE') totalExpense = totalExpense.add(a.debit.sub(a.credit));
    }
    // Utilidad del ejercicio se suma al patrimonio para que el balance cuadre.
    const retained = totalIncome.sub(totalExpense);
    equity.push({ code: '3900', name: 'Utilidad del ejercicio', amount: retained.toFixed(2) });
    totalEquity = totalEquity.add(retained);
    [assets, liabilities, equity].forEach((g) => g.sort((x, y) => x.code.localeCompare(y.code)));
    return {
      asOf, assets, liabilities, equity,
      totalAssets: totalAssets.toFixed(2),
      totalLiabilities: totalLiab.toFixed(2),
      totalEquity: totalEquity.toFixed(2),
      balanced: totalAssets.sub(totalLiab.add(totalEquity)).abs().lte(D('0.01')),
    };
  }

  async exportAccounts(tenantId: string, format: 'csv' | 'xlsx'): Promise<Buffer> {
    const accounts = await this.listAccounts(tenantId);
    const rows = accounts.map((a) => ({ code: a.code, name: a.name, type: a.type }));
    return buildSpreadsheet(format, 'Catalogo', ACCOUNT_EXPORT_COLUMNS, rows);
  }
}

const ACCOUNT_EXPORT_COLUMNS: SheetColumn[] = [
  { header: 'Código', key: 'code', width: 14 },
  { header: 'Nombre', key: 'name', width: 40 },
  { header: 'Tipo', key: 'type', width: 14 },
];

function normalizeType(raw: string): AccountType | null {
  const t = (raw || '').trim().toLowerCase();
  if (['asset', 'liability', 'equity', 'income', 'expense'].includes(t)) return t.toUpperCase() as AccountType;
  return TYPE_ALIASES[t] ?? null;
}

function guessAccountField(header: string): string {
  const h = (header || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (h.includes('codigo') || h.includes('code') || h.includes('cuenta')) return 'code';
  if (h.includes('tipo') || h.includes('type') || h.includes('clase')) return 'type';
  if (h.includes('nombre') || h.includes('name') || h.includes('descrip')) return 'name';
  return '';
}

function cryptoRandom(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
