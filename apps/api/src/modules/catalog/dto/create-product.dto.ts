import { ProductType } from '@prisma/client';

/**
 * Payload for creating a product (Premium Product Model — Micropetition #1).
 * `price` is the derived final (tax-inclusive) price; if the client only sends
 * `basePrice` + `taxPercentage`, the service computes `price` automatically.
 */
export class CreateProductDto {
  name: string;
  description?: string;
  sku?: string;
  barcode?: string;

  type?: ProductType; // PRODUCT | SERVICE | COMBO
  hasVariants?: boolean;
  uom?: string; // unit of measure, e.g. "Unidad", "Libra", "Litro"

  basePrice?: number;
  taxPercentage?: number; // e.g. 18 for ITBIS
  taxType?: string; // e.g. "ITBIS", "EXENTO"
  price?: number; // legacy / explicit final price

  cost?: number;
  stock?: number;
  quantityMin?: number;
  quantityMax?: number | null;
  categoryId?: string;
  imageUrl?: string;
}
