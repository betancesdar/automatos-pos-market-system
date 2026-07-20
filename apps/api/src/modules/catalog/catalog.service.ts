import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';

const COMMON_DOMINICAN_PRODUCTS = [
  { barcode: '7460111111111', name: 'Refresco Imperio Rojo 500ml', category: 'Bebidas' },
  { barcode: '7460222222222', name: 'Salami Super Especial Induveca', category: 'Embutidos' },
  { barcode: '7460333333333', name: 'Ron Brugal Añejo 700ml', category: 'Licores' },
  { barcode: '7460444444444', name: 'Jugo Rica Naranja 1L', category: 'Bebidas' },
  { barcode: '7460555555555', name: 'Cerveza Presidente Grande', category: 'Bebidas' },
  { barcode: '7460666666666', name: 'Queso Sosua Geo', category: 'Lácteos' },
  { barcode: '7460777777777', name: 'Pan Integral Pepin', category: 'Panadería' },
];

function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length, len2 = s2.length;
  const matrix = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
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

  async getProductByBarcode(tenantId: string, barcode: string) {
    const cacheKey = `product:${tenantId}:${barcode}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return { source: 'cache', product: cached };
    }

    const product = await this.prisma.product.findUnique({
      where: {
        barcode_tenantId: {
          barcode,
          tenantId,
        },
      },
    });

    if (product) {
      await this.cacheManager.set(cacheKey, product, 300000); // 5 mins
      return { source: 'database', product };
    }

    // Not found - run Levenshtein suggestion
    let bestMatch: (typeof COMMON_DOMINICAN_PRODUCTS)[number] | null = null;
    let minDistance = Infinity;

    for (const p of COMMON_DOMINICAN_PRODUCTS) {
      const distance = levenshteinDistance(barcode, p.barcode);
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = p;
      }
    }

    // If it's somewhat close (e.g., same manufacturer prefix)
    const suggestion = minDistance <= 5 ? bestMatch : null;

    return {
      source: 'suggestion',
      product: null,
      suggestion,
    };
  }

  async addProduct(tenantId: string, data: {
    barcode?: string;
    name: string;
    price: number;
    cost?: number;
    stock?: number;
    category?: string;
  }) {
    if (!data.name?.trim()) throw new BadRequestException('Product name is required');
    if (data.price == null || data.price < 0) throw new BadRequestException('Valid price is required');
    if (data.cost != null && data.cost < 0) throw new BadRequestException('Cost cannot be negative');
    if (data.stock != null && data.stock < 0) throw new BadRequestException('Stock cannot be negative');

    const product = await this.prisma.product.create({
      data: {
        barcode: data.barcode?.trim() || null,
        name: data.name.trim(),
        price: data.price,
        cost: data.cost ?? 0,
        stock: data.stock ?? 0,
        category: data.category?.trim() || null,
        tenantId,
      },
    });

    if (product.barcode) {
      await this.cacheManager.set(`product:${tenantId}:${product.barcode}`, product, 300000);
    }

    return product;
  }

  async listProducts(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async updateProduct(tenantId: string, productId: string, data: Partial<{
    barcode: string;
    name: string;
    price: number;
    cost: number;
    stock: number;
    category: string;
  }>) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(data.barcode !== undefined && { barcode: data.barcode?.trim() || null }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.cost !== undefined && { cost: data.cost }),
        ...(data.stock !== undefined && { stock: data.stock }),
        ...(data.category !== undefined && { category: data.category?.trim() || null }),
      },
    });

    if (updated.barcode) {
      await this.cacheManager.set(`product:${tenantId}:${updated.barcode}`, updated, 300000);
    }
    return updated;
  }

  async deleteProduct(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id: productId } });
    return { deleted: true };
  }
}
