const ESC = '\x1b';
const GS = '\x1d';

// Standard ESC/POS control sequences
export const ESCPOS_CASH_DRAWER_KICK = '\x1B\x70\x00\x19\xFA';
export const ESCPOS_AUTO_CUT = '\x1D\x56\x00';

export interface ReceiptTenant {
  name: string;
  commercialName?: string | null;
  rnc?: string | null;
  phone?: string | null;
  address?: string | null;
  receiptFooter?: string | null;
  receiptLogoUrl?: string | null;
  paperSize?: string | null;
}

/** Returns the character width for a given thermal paper size. */
export function paperCharWidth(paperSize?: string | null): number {
  return paperSize === '58mm' ? 24 : 32;
}

export function encodeEscPos(content: string): string {
  return Buffer.from(content, 'ascii').toString('base64');
}

export function escPosHeader(tenant: ReceiptTenant): string {
  const width = paperCharWidth(tenant.paperSize);
  let receipt = `${ESC}@`;
  receipt += `${ESC}a1${ESC}E1${GS}!\x11${tenant.commercialName || tenant.name}\n`;
  receipt += `${GS}!\x00${ESC}E0`;
  if (tenant.rnc) receipt += `RNC: ${tenant.rnc}\n`;
  if (tenant.phone) receipt += `Tel: ${tenant.phone}\n`;
  if (tenant.address) receipt += `${tenant.address}\n`;
  receipt += '-'.repeat(width) + '\n';
  return receipt;
}

export function escPosFooter(tenant?: ReceiptTenant): string {
  let receipt = '\n\n';
  receipt += `${ESC}a1${tenant?.receiptFooter || 'GRACIAS POR SU COMPRA'}\n`;
  receipt += ESCPOS_CASH_DRAWER_KICK;
  receipt += ESCPOS_AUTO_CUT;
  return receipt;
}

interface SaleReceiptData {
  tenant: ReceiptTenant;
  ncf: string | null;
  ncfType: string;
  clientRnc: string | null;
  applyItbis: boolean;
  itbis: number;
  paymentMethod: string;
  createdAt: Date;
  items: { product: { name: string }; quantity: number; price: number }[];
  total: number;
  cashReceived: number | null;
  changeDue: number | null;
}

/**
 * Builds a full thermal sale receipt (ESC/POS), including the cash drawer
 * kick and auto-cut commands, base64-encoded for transport over Web Serial.
 */
export function buildSaleReceipt(sale: SaleReceiptData): string {
  const width = paperCharWidth(sale.tenant.paperSize);
  let receipt = escPosHeader(sale.tenant);

  receipt += `NCF: ${sale.ncf || 'N/A'}\n`;
  receipt += `Tipo: ${sale.ncfType}\n`;
  if (sale.clientRnc) receipt += `Cliente RNC: ${sale.clientRnc}\n`;
  if (sale.applyItbis) receipt += `ITBIS: RD$ ${sale.itbis.toFixed(2)}\n`;
  receipt += `Pago: ${sale.paymentMethod}\n`;
  receipt += `Fecha: ${sale.createdAt.toLocaleString('es-DO')}\n`;
  receipt += '-'.repeat(width) + '\n';
  receipt += 'Cant   Descripcion        Importe\n';

  for (const item of sale.items) {
    const name = item.product.name.substring(0, 16).padEnd(16, ' ');
    const qty = item.quantity.toFixed(2).padEnd(4, ' ');
    const price = (item.price * item.quantity).toFixed(2).padStart(8, ' ');
    receipt += `${qty} ${name} ${price}\n`;
  }

  receipt += '-'.repeat(width) + '\n' + `${ESC}a1${GS}!\x11${ESC}E1`;
  receipt += `TOTAL: RD$ ${sale.total.toFixed(2)}\n`;
  receipt += `${GS}!\x00${ESC}E0${ESC}a0`;
  if (sale.cashReceived != null) receipt += `Recibido: RD$ ${sale.cashReceived.toFixed(2)}\n`;
  if (sale.changeDue != null) receipt += `Devuelta: RD$ ${sale.changeDue.toFixed(2)}\n`;

  receipt += escPosFooter(sale.tenant);
  return encodeEscPos(receipt);
}

export function buildCashCloseReceipt(
  tenant: ReceiptTenant,
  log: { expectedCash: number; countedCash: number; discrepancy: number; notes?: string | null; createdAt: Date },
  status: string,
  message: string,
): string {
  const width = paperCharWidth(tenant.paperSize);
  let receipt = escPosHeader(tenant);
  receipt += `${ESC}a1${ESC}E1CIERRE DE CAJA\n${ESC}E0`;
  receipt += `${ESC}a0`;
  receipt += `Fecha: ${log.createdAt.toLocaleString('es-DO')}\n`;
  receipt += '-'.repeat(width) + '\n';
  receipt += `Esperado:  RD$ ${log.expectedCash.toFixed(2)}\n`;
  receipt += `Contado:   RD$ ${log.countedCash.toFixed(2)}\n`;
  receipt += `Diferencia: RD$ ${log.discrepancy.toFixed(2)}\n`;
  receipt += `Estado: ${status}\n`;
  receipt += `${message}\n`;
  if (log.notes) receipt += `Notas: ${log.notes}\n`;
  receipt += escPosFooter(tenant);
  return encodeEscPos(receipt);
}

/**
 * Builds the blind-count cash session close receipt (Apertura/Cierre de Caja audit).
 */
export function buildCashSessionCloseReceipt(
  tenant: ReceiptTenant,
  session: {
    openedAt: Date;
    closedAt: Date;
    openingBalance: number;
    expectedClosingBalance: number;
    actualClosingBalance: number;
  },
  cashierName: string,
): string {
  const width = paperCharWidth(tenant.paperSize);
  const variance = parseFloat((session.actualClosingBalance - session.expectedClosingBalance).toFixed(2));
  const status = variance === 0 ? 'CAJA CUADRADA' : variance > 0 ? 'SOBRANTE' : 'FALTANTE';

  let receipt = escPosHeader(tenant);
  receipt += `${ESC}a1${ESC}E1CIERRE DE CAJA\n${ESC}E0`;
  receipt += `${ESC}a0`;
  receipt += `Cajero: ${cashierName}\n`;
  receipt += `Apertura: ${session.openedAt.toLocaleString('es-DO')}\n`;
  receipt += `Cierre:   ${session.closedAt.toLocaleString('es-DO')}\n`;
  receipt += '-'.repeat(width) + '\n';
  receipt += `Fondo inicial:     RD$ ${session.openingBalance.toFixed(2)}\n`;
  receipt += `Esperado en caja:  RD$ ${session.expectedClosingBalance.toFixed(2)}\n`;
  receipt += `Contado (físico):  RD$ ${session.actualClosingBalance.toFixed(2)}\n`;
  receipt += `Diferencia:        RD$ ${variance.toFixed(2)}\n`;
  receipt += `Estado: ${status}\n`;
  receipt += escPosFooter(tenant);
  return encodeEscPos(receipt);
}
