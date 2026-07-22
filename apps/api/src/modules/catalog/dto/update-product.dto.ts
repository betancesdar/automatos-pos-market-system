import { CreateProductDto } from './create-product.dto';

/**
 * Payload for updating a product. All fields optional (partial update).
 */
export class UpdateProductDto implements Partial<CreateProductDto> {
  name?: string;
  description?: string;
  sku?: string;
  barcode?: string;

  type?: CreateProductDto['type'];
  hasVariants?: boolean;
  uom?: string;

  basePrice?: number;
  taxPercentage?: number;
  taxType?: string;
  price?: number;

  cost?: number;
  stock?: number;
  categoryId?: string;
  imageUrl?: string;
}
