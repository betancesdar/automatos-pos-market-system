import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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
        imageUrl: data.imageUrl?.trim() || null,
        tenantId,
      },
      include: { category: true },
    });

    if (product.barcode) {
      await this.cacheManager.set(`product:${tenantId}:${product.barcode}`, product, 300000);
    }
    return product;
  }

  async listProducts(tenantId: string, categorySlug?: string, search?: string, categoryId?: string) {
    await this.ensureDefaultCategories(tenantId);

    const where: Record<string, unknown> = { tenantId };
    if (categoryId) {
      where.categoryId = categoryId;
    } else if (categorySlug && categorySlug !== 'TODOS') {
      where.category = { slug: categorySlug };
    }
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { barcode: { contains: search.trim() } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      include: { category: true },
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
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl?.trim() || null }),
      },
      include: { category: true },
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
}
