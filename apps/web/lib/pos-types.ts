export const POS_CATEGORY_TABS = [
  { slug: 'TODOS', label: 'TODOS' },
  { slug: 'BEBIDAS', label: 'BEBIDAS' },
  { slug: 'ALIMENTOS', label: 'ALIMENTOS' },
  { slug: 'LIMPIEZA', label: 'LIMPIEZA' },
  { slug: 'CUIDADO_PERSONAL', label: 'CUIDADO PERSONAL' },
  { slug: 'OTROS', label: 'OTROS' },
] as const;

export type CategorySlug = (typeof POS_CATEGORY_TABS)[number]['slug'];

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  createdAt?: string;
  _count?: { products: number };
}

export const RECEIPT_TYPES = [
  {
    value: 'VENTA_RAPIDA',
    label: 'Venta rápida (sin comprobante)',
    applyItbis: false,
    needsRnc: false,
    help: 'Para el día a día sin comprobante fiscal. No se envía a la DGII.',
  },
  {
    value: 'CONSUMIDOR_FINAL',
    label: 'Consumidor Final (B02) — e-CF 32',
    applyItbis: true,
    needsRnc: false,
    help: 'Factura de consumo con NCF para un cliente que pide comprobante. Es la más común.',
  },
  {
    value: 'CREDITO_FISCAL',
    label: 'Crédito Fiscal (B01) — e-CF 31',
    applyItbis: true,
    needsRnc: true,
    help: 'Para EMPRESAS con RNC que necesitan descontar el ITBIS. Requiere el RNC del cliente.',
  },
  {
    value: 'GUBERNAMENTAL',
    label: 'Gubernamental (B15) — e-CF 45',
    applyItbis: true,
    needsRnc: true,
    help: 'Ventas a instituciones del Estado. Requiere el RNC de la institución.',
  },
  {
    value: 'REGISTRO_UNICO_INGRESO',
    label: 'Registro Único de Ingreso',
    applyItbis: true,
    needsRnc: false,
    help: 'Para resumir varias ventas de consumo del día en un solo comprobante.',
  },
  {
    value: 'SIN_NCF',
    label: 'Consumo (sin NCF)',
    applyItbis: false,
    needsRnc: false,
    help: 'Consumo sin número de comprobante fiscal.',
  },
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

export interface CashSession {
  id: string;
  tenantId: string;
  userId: string;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  expectedClosingBalance: number | null;
  actualClosingBalance: number | null;
  status: 'OPEN' | 'CLOSED';
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

// ── Flujo Facturador/Caja ────────────────────────────────────────────────────

export type WorkflowMode = 'DIRECT' | 'BILLER_CASHIER';

export interface PendingOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  isLoose: boolean;
  product?: { name: string; stock: number };
}

export interface PendingOrder {
  id: string;
  dailyCode: number;
  businessDate: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  clientName: string | null;
  clientRnc: string | null;
  ncfType: ReceiptTypeValue | string;
  notes: string | null;
  subtotal: number;
  createdAt: string;
  creator?: { id: string; name: string; username: string };
  items: PendingOrderItem[];
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
