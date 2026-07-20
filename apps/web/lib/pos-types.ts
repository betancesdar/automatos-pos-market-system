export const POS_CATEGORY_TABS = [
  { slug: 'TODOS', label: 'TODOS' },
  { slug: 'BEBIDAS', label: 'BEBIDAS' },
  { slug: 'ALIMENTOS', label: 'ALIMENTOS' },
  { slug: 'LIMPIEZA', label: 'LIMPIEZA' },
  { slug: 'CUIDADO_PERSONAL', label: 'CUIDADO PERSONAL' },
  { slug: 'OTROS', label: 'OTROS' },
] as const;

export type CategorySlug = (typeof POS_CATEGORY_TABS)[number]['slug'];

export const RECEIPT_TYPES = [
  { value: 'SIN_NCF', label: 'Consumo (Sin NCF)', applyItbis: false, needsRnc: false },
  { value: 'CREDITO_FISCAL', label: 'Crédito Fiscal (Requiere RNC)', applyItbis: true, needsRnc: true },
  { value: 'REGISTRO_UNICO_INGRESO', label: 'Registro de Único Ingreso', applyItbis: true, needsRnc: false },
  { value: 'VENTA_RAPIDA', label: 'Sin NCF / Venta Rápida', applyItbis: false, needsRnc: false },
] as const;

export type ReceiptTypeValue = (typeof RECEIPT_TYPES)[number]['value'];

export interface PosProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  barcode: string | null;
  imageUrl: string | null;
  category?: { id: string; name: string; slug: string } | null;
}

export interface CartLine {
  cartId: string;
  productId: string;
  name: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  isLoose: boolean;
}

export function lineTotal(item: CartLine): number {
  return parseFloat((item.unitPrice * item.quantity).toFixed(2));
}

export function productEmoji(slug?: string | null): string {
  switch (slug) {
    case 'BEBIDAS': return '🥤';
    case 'ALIMENTOS': return '🍽️';
    case 'LIMPIEZA': return '🧴';
    case 'CUIDADO_PERSONAL': return '🧼';
    default: return '📦';
  }
}
