import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { buildSpreadsheet, readTabular, type SheetColumn } from '../../common/spreadsheet.util';
import { parseXpsToRows } from '../../common/xps-parser.util';

/** Final (tax-inclusive) price = basePrice * (1 + taxPercentage/100). */
export function computeFinalPrice(basePrice: number, taxPercentage: number): number {
  return parseFloat((basePrice * (1 + (taxPercentage || 0) / 100)).toFixed(2));
}

const DEFAULT_CATEGORIES = [
  { name: 'Bebidas', slug: 'BEBIDAS' },
  { name: 'Alimentos', slug: 'ALIMENTOS' },
  { name: 'Limpieza', slug: 'LIMPIEZA' },
  { name: 'Cuidado Personal', slug: 'CUIDADO_PERSONAL' },
  { name: 'Otros', slug: 'OTROS' },
];

const COMMON_DOMINICAN_PRODUCTS = [
  { barcode: '7460111111111', name: 'Refresco Imperio Rojo 500ml', category: 'BEBIDAS' },
  { barcode: '7460222222222', name: 'Salami Super Especial Induveca', category: 'ALIMENTOS' },
  { barcode: '7460333333333', name: 'Ron Brugal Añejo 700ml', category: 'BEBIDAS' },
  { barcode: '7460444444444', name: 'Jugo Rica Naranja 1L', category: 'BEBIDAS' },
  { barcode: '7460555555555', name: 'Cerveza Presidente Grande', category: 'BEBIDAS' },
];

function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length, len2 = s2.length;
  const matrix = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[len1][len2];
}

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async ensureDefaultCategories(tenantId: string) {
    for (const cat of DEFAULT_CATEGORIES) {
      await this.prisma.category.upsert({
        where: { slug_tenantId: { slug: cat.slug, tenantId } },
        create: { ...cat, tenantId },
        update: {},
      });
    }
  }

  async listCategories(tenantId: string) {
    await this.ensureDefaultCategories(tenantId);
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async getProductByBarcode(tenantId: string, barcode: string) {
    const cacheKey = `product:${tenantId}:${barcode}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return { source: 'cache', product: cached };

    const product = await this.prisma.product.findUnique({
      where: { barcode_tenantId: { barcode, tenantId } },
      include: { category: true },
    });

    if (product) {
      await this.cacheManager.set(cacheKey, product, 300000);
      return { source: 'database', product };
    }

    let bestMatch: (typeof COMMON_DOMINICAN_PRODUCTS)[number] | null = null;
    let minDistance = Infinity;
    for (const p of COMMON_DOMINICAN_PRODUCTS) {
      const distance = levenshteinDistance(barcode, p.barcode);
      if (distance < minDistance) { minDistance = distance; bestMatch = p; }
    }

    return { source: 'suggestion', product: null, suggestion: minDistance <= 5 ? bestMatch : null };
  }

  /** Generates a unique-per-tenant SKU derived from the product name. */
  private async generateSku(tenantId: string, name: string): Promise<string> {
    const base =
      name
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 6) || 'PROD';
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = `${base}-${Math.floor(1000 + Math.random() * 9000)}`;
      const existing = await this.prisma.product.findFirst({ where: { tenantId, sku: candidate } });
      if (!existing) return candidate;
    }
    return `${base}-${Date.now().toString(36).toUpperCase()}`;
  }

  /**
   * Resolves basePrice / taxPercentage / final price coherently:
   * - If basePrice is provided (> 0), the final price is derived from it.
   * - Otherwise, if a legacy `price` is provided, basePrice is back-derived.
   */
  private resolvePricing(input: { basePrice?: number; taxPercentage?: number; price?: number }) {
    const taxPercentage = input.taxPercentage ?? 18;
    let basePrice = input.basePrice ?? 0;
    let price: number;

    if (basePrice > 0) {
      price = computeFinalPrice(basePrice, taxPercentage);
    } else if (input.price != null && input.price > 0) {
      price = parseFloat(input.price.toFixed(2));
      basePrice = parseFloat((price / (1 + taxPercentage / 100)).toFixed(2));
    } else {
      basePrice = 0;
      price = 0;
    }
    return { basePrice, taxPercentage, price };
  }

  async addProduct(tenantId: string, data: CreateProductDto) {
    if (!data.name?.trim()) throw new BadRequestException('Product name is required');

    // Plan limit enforcement (only when the tenant has a Plan assigned).
    const tenantPlan = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planRef: { select: { maxProducts: true, name: true } } },
    });
    if (tenantPlan?.planRef) {
      const count = await this.prisma.product.count({ where: { tenantId } });
      if (count >= tenantPlan.planRef.maxProducts) {
        throw new BadRequestException(
          `Límite del plan ${tenantPlan.planRef.name} alcanzado (${tenantPlan.planRef.maxProducts} productos). Contacta al administrador para ampliar tu plan.`,
        );
      }
    }
    this.validateInventoryBounds(data.quantityMin ?? 0, data.quantityMax ?? 0);

    const { basePrice, taxPercentage, price } = this.resolvePricing(data);
    if (price < 0) throw new BadRequestException('Valid price is required');

    // SKU: use provided (validate uniqueness) or auto-generate.
    let sku = data.sku?.trim() || null;
    if (sku) {
      const clash = await this.prisma.product.findFirst({ where: { tenantId, sku } });
      if (clash) throw new BadRequestException(`El SKU "${sku}" ya existe para este negocio`);
    } else {
      sku = await this.generateSku(tenantId, data.name);
    }

    const product = await this.prisma.product.create({
      data: {
        barcode: data.barcode?.trim() || null,
        sku,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        type: data.type ?? ProductType.PRODUCT,
        hasVariants: data.hasVariants ?? false,
        uom: data.uom?.trim() || 'Unidad',
        basePrice,
        taxPercentage,
        taxType: data.taxType?.trim() || 'ITBIS',
        price,
        cost: data.cost ?? 0,
        stock: data.stock ?? 0,
        quantityMin: data.quantityMin ?? 0,
        quantityMax: data.quantityMax ?? 0,
        categoryId: data.categoryId || null,
        zoneId: data.zoneId || null,
        imageUrl: data.imageUrl?.trim() || null,
        tenantId,
      },
      include: { category: true, zone: true },
    });

    if (product.barcode) {
      await this.cacheManager.set(`product:${tenantId}:${product.barcode}`, product, 300000);
    }
    return product;
  }

  async listProducts(tenantId: string, categorySlug?: string, search?: string, categoryId?: string, zoneId?: string) {
    await this.ensureDefaultCategories(tenantId);

    const where: Record<string, unknown> = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    } else if (categorySlug && categorySlug !== 'TODOS') {
      where.category = { slug: categorySlug };
    }
    if (zoneId) {
      where.zoneId = zoneId === 'NONE' ? null : zoneId;
    }
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { barcode: { contains: search.trim() } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      include: { category: true, zone: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateProduct(tenantId: string, productId: string, data: UpdateProductDto) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (data.quantityMin !== undefined || data.quantityMax !== undefined) {
      this.validateInventoryBounds(
        data.quantityMin ?? product.quantityMin,
        data.quantityMax ?? product.quantityMax,
      );
    }

    // Recompute pricing whenever any pricing input changes.
    const pricingTouched =
      data.basePrice !== undefined || data.taxPercentage !== undefined || data.price !== undefined;
    const pricing = pricingTouched
      ? this.resolvePricing({
          basePrice: data.basePrice ?? product.basePrice,
          taxPercentage: data.taxPercentage ?? product.taxPercentage,
          price: data.basePrice !== undefined ? undefined : data.price,
        })
      : null;

    // SKU uniqueness (if changed).
    if (data.sku !== undefined && data.sku?.trim() && data.sku.trim() !== product.sku) {
      const clash = await this.prisma.product.findFirst({
        where: { tenantId, sku: data.sku.trim(), id: { not: productId } },
      });
      if (clash) throw new BadRequestException(`El SKU "${data.sku.trim()}" ya existe para este negocio`);
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(data.barcode !== undefined && { barcode: data.barcode?.trim() || null }),
        ...(data.sku !== undefined && { sku: data.sku?.trim() || null }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.hasVariants !== undefined && { hasVariants: data.hasVariants }),
        ...(data.uom !== undefined && { uom: data.uom?.trim() || 'Unidad' }),
        ...(data.taxType !== undefined && { taxType: data.taxType?.trim() || 'ITBIS' }),
        ...(pricing && { basePrice: pricing.basePrice, taxPercentage: pricing.taxPercentage, price: pricing.price }),
        ...(data.cost !== undefined && { cost: data.cost }),
        ...(data.stock !== undefined && { stock: data.stock }),
        ...(data.quantityMin !== undefined && { quantityMin: data.quantityMin }),
        ...(data.quantityMax !== undefined && { quantityMax: data.quantityMax }),
        ...(data.categoryId !== undefined && { categoryId: data.categoryId || null }),
        ...(data.zoneId !== undefined && { zoneId: data.zoneId || null }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl?.trim() || null }),
      },
      include: { category: true, zone: true },
    });

    if (updated.barcode) {
      await this.cacheManager.set(`product:${tenantId}:${updated.barcode}`, updated, 300000);
    }
    return updated;
  }

  private validateInventoryBounds(quantityMin: number, quantityMax: number | null) {
    if (quantityMin < 0 || (quantityMax != null && quantityMax < 0)) {
      throw new BadRequestException('Los límites de inventario no pueden ser negativos');
    }
    if (quantityMax != null && quantityMax > 0 && quantityMin > quantityMax) {
      throw new BadRequestException('La cantidad mínima no puede superar la cantidad máxima');
    }
  }

  async deleteProduct(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id: productId } });
    return { deleted: true };
  }

  // ─────────────────────── Exportar inventario (CSV / XLSX) ───────────────────────

  async exportProducts(tenantId: string, format: 'csv' | 'xlsx'): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      where: { tenantId },
      include: { category: { select: { name: true } }, zone: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const rows = products.map((p) => ({
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      name: p.name,
      category: p.category?.name ?? '',
      zone: p.zone?.name ?? '',
      cost: p.cost,
      basePrice: p.basePrice,
      tax: p.taxPercentage,
      price: p.price,
      stock: p.stock,
      min: p.quantityMin,
      uom: p.uom ?? 'Unidad',
    }));
    return buildSpreadsheet(format, 'Inventario', EXPORT_COLUMNS, rows);
  }

  // ─────────────────────── Importar inventario (CSV / XLSX / XPS) ───────────────────────

  /** Paso 1: lee el archivo a filas y sugiere el mapeo de columnas (sin tocar la BD). */
  async parseImportFile(buffer: Buffer, filename: string) {
    const ext = (filename.split('.').pop() ?? '').toLowerCase();
    let rows: string[][];
    let source: 'csv' | 'xlsx' | 'xps';
    let hasHeaderRow: boolean;

    if (ext === 'xps') {
      rows = await parseXpsToRows(buffer);
      source = 'xps';
      hasHeaderRow = false; // el XPS no trae encabezados fiables
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

    // Normalizar ancho de columnas (todas las filas con la misma cantidad).
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows = rows.map((r) => {
      const copy = r.slice(0, width);
      while (copy.length < width) copy.push('');
      return copy;
    });

    const suggestedMapping = hasHeaderRow ? rows[0].map((h) => guessField(h)) : new Array(width).fill('');

    return { source, hasHeaderRow, rows: rows.slice(0, 500), totalRows: rows.length, suggestedMapping, fields: IMPORT_FIELDS };
  }

  /** Paso 2: aplica el import con el mapeo confirmado. Devuelve un resumen. */
  async commitImport(
    tenantId: string,
    dto: {
      rows: string[][];
      mapping: string[]; // por índice de columna → field ('' = ignorar)
      hasHeaderRow?: boolean;
      options?: { updateExisting?: boolean; createMissingCategories?: boolean; createMissingZones?: boolean };
    },
  ) {
    const options = {
      updateExisting: dto.options?.updateExisting ?? true,
      createMissingCategories: dto.options?.createMissingCategories ?? true,
      createMissingZones: dto.options?.createMissingZones ?? true,
    };
    const mapping = dto.mapping ?? [];
    const colOf = (field: string) => mapping.findIndex((f) => f === field);
    if (colOf('name') < 0) {
      throw new BadRequestException('Debes mapear al menos la columna «Nombre».');
    }

    let dataRows = dto.rows ?? [];
    if (dto.hasHeaderRow) dataRows = dataRows.slice(1);

    const get = (row: string[], field: string): string => {
      const i = colOf(field);
      return i >= 0 ? (row[i] ?? '').trim() : '';
    };

    // Catálogos en memoria (nombre en minúsculas → id); se crean faltantes si aplica.
    const [cats, zones] = await Promise.all([
      this.prisma.category.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.zone.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);
    const catMap = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const zoneMap = new Map(zones.map((z) => [z.name.toLowerCase(), z.id]));

    const tenantPlan = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planRef: { select: { maxProducts: true, name: true } } },
    });
    const maxProducts = tenantPlan?.planRef?.maxProducts ?? Infinity;
    let productCount = await this.prisma.product.count({ where: { tenantId } });

    const resolveCategory = async (name: string): Promise<string | null> => {
      if (!name) return null;
      const key = name.toLowerCase();
      if (catMap.has(key)) return catMap.get(key)!;
      if (!options.createMissingCategories) return null;
      const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'CAT';
      const created = await this.prisma.category.create({ data: { tenantId, name, slug: `${slug}_${Date.now().toString(36)}` } });
      catMap.set(key, created.id);
      return created.id;
    };
    const resolveZone = async (name: string): Promise<string | null> => {
      if (!name) return null;
      const key = name.toLowerCase();
      if (zoneMap.has(key)) return zoneMap.get(key)!;
      if (!options.createMissingZones) return null;
      const created = await this.prisma.zone.create({ data: { tenantId, name } });
      zoneMap.set(key, created.id);
      return created.id;
    };

    let created = 0, updated = 0, skipped = 0;
    const errors: { row: number; name: string; reason: string }[] = [];

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const rowNum = idx + 1 + (dto.hasHeaderRow ? 1 : 0);
      const name = get(row, 'name');
      if (!name) { skipped += 1; continue; }

      try {
        const barcode = get(row, 'barcode') || null;
        const sku = get(row, 'sku') || null;
        const cost = parseNumber(get(row, 'cost'));
        const tax = get(row, 'tax') ? parseNumber(get(row, 'tax')) : 18;
        const basePriceRaw = parseNumber(get(row, 'basePrice'));
        const priceRaw = parseNumber(get(row, 'price'));
        const { basePrice, taxPercentage, price } = this.resolvePricing({
          basePrice: basePriceRaw > 0 ? basePriceRaw : undefined,
          price: priceRaw > 0 ? priceRaw : undefined,
          taxPercentage: tax,
        });
        const stock = Math.round(parseNumber(get(row, 'stock')));
        const min = parseNumber(get(row, 'min'));
        const uom = get(row, 'uom') || 'Unidad';
        const categoryId = await resolveCategory(get(row, 'category'));
        const zoneId = await resolveZone(get(row, 'zone'));

        // Match: código de barra → SKU.
        const existing = barcode
          ? await this.prisma.product.findFirst({ where: { tenantId, barcode } })
          : sku
            ? await this.prisma.product.findFirst({ where: { tenantId, sku } })
            : null;

        if (existing) {
          if (!options.updateExisting) { skipped += 1; continue; }
          await this.prisma.product.update({
            where: { id: existing.id },
            data: {
              name, barcode, basePrice, taxPercentage, price, cost, stock,
              quantityMin: min, uom,
              ...(categoryId ? { categoryId } : {}),
              ...(zoneId ? { zoneId } : {}),
            },
          });
          updated += 1;
        } else {
          if (productCount >= maxProducts) {
            errors.push({ row: rowNum, name, reason: `Límite del plan alcanzado (${maxProducts} productos)` });
            continue;
          }
          let finalSku = sku;
          if (finalSku) {
            const clash = await this.prisma.product.findFirst({ where: { tenantId, sku: finalSku } });
            if (clash) finalSku = `${finalSku}-${Date.now().toString(36)}`;
          } else {
            finalSku = await this.generateSku(tenantId, name);
          }
          await this.prisma.product.create({
            data: {
              tenantId, name, barcode, sku: finalSku,
              basePrice, taxPercentage, taxType: 'ITBIS', price, cost, stock,
              quantityMin: min, uom, categoryId, zoneId,
            },
          });
          created += 1;
          productCount += 1;
        }
      } catch (e) {
        errors.push({ row: rowNum, name, reason: e instanceof Error ? e.message : 'Error desconocido' });
      }
    }

    return { created, updated, skipped, errorCount: errors.length, errors: errors.slice(0, 50), processed: dataRows.length };
  }
}

const EXPORT_COLUMNS: SheetColumn[] = [
  { header: 'SKU/Referencia', key: 'sku', width: 18 },
  { header: 'Código de barra', key: 'barcode', width: 18 },
  { header: 'Nombre', key: 'name', width: 34 },
  { header: 'Categoría', key: 'category', width: 18 },
  { header: 'Zona', key: 'zone', width: 16 },
  { header: 'Costo', key: 'cost', width: 12 },
  { header: 'Precio base', key: 'basePrice', width: 12 },
  { header: 'ITBIS %', key: 'tax', width: 10 },
  { header: 'Precio final', key: 'price', width: 12 },
  { header: 'Stock', key: 'stock', width: 10 },
  { header: 'Stock mínimo', key: 'min', width: 12 },
  { header: 'Unidad', key: 'uom', width: 12 },
];

export const IMPORT_FIELDS = [
  { value: 'name', label: 'Nombre' },
  { value: 'sku', label: 'SKU / Referencia' },
  { value: 'barcode', label: 'Código de barra' },
  { value: 'category', label: 'Categoría' },
  { value: 'zone', label: 'Zona' },
  { value: 'cost', label: 'Costo' },
  { value: 'basePrice', label: 'Precio base (sin ITBIS)' },
  { value: 'price', label: 'Precio final (con ITBIS)' },
  { value: 'tax', label: 'ITBIS %' },
  { value: 'stock', label: 'Stock / Cantidad' },
  { value: 'min', label: 'Stock mínimo' },
  { value: 'uom', label: 'Unidad' },
];

/** Normaliza un texto numérico con posibles símbolos, miles y decimales (coma o punto). */
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

/** Adivina a qué campo corresponde un encabezado de columna. */
function guessField(header: string): string {
  const h = (header || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const has = (...keys: string[]) => keys.some((k) => h.includes(k));
  if (has('barra', 'barcode', 'ean', 'upc')) return 'barcode';
  if (has('sku', 'referencia', 'ref.', 'clave', 'codigo interno')) return 'sku';
  if (has('categor', 'familia', 'rubro', 'grupo')) return 'category';
  if (has('zona', 'ubicaci', 'localizaci', 'pasillo', 'estante', 'anaquel')) return 'zone';
  if (has('costo', 'compra')) return 'cost';
  if (has('base')) return 'basePrice';
  if (has('itbis', 'impuesto', 'iva', 'tax')) return 'tax';
  if (has('precio', 'venta', 'pvp')) return 'price';
  if (has('minim')) return 'min';
  if (has('stock', 'cantidad', 'existenc', 'inventario', 'exist', 'qty')) return 'stock';
  if (has('unidad', 'medida', 'uom', 'um')) return 'uom';
  if (has('nombre', 'descrip', 'producto', 'articulo', 'detalle')) return 'name';
  return '';
}
