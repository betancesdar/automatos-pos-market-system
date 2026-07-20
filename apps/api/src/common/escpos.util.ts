const ESC = '\x1b';
const GS = '\x1d';

export function encodeEscPos(content: string): string {
  return Buffer.from(content, 'ascii').toString('base64');
}

export function escPosHeader(tenant: { name: string; rnc?: string | null; phone?: string | null; address?: string | null }): string {
  let receipt = `${ESC}@`;
  receipt += `${ESC}a1${ESC}E1${GS}!\x11${tenant.name}\n`;
  receipt += `${GS}!\x00${ESC}E0`;
  if (tenant.rnc) receipt += `RNC: ${tenant.rnc}\n`;
  if (tenant.phone) receipt += `Tel: ${tenant.phone}\n`;
  if (tenant.address) receipt += `${tenant.address}\n`;
  receipt += '--------------------------------\n';
  return receipt;
}

export function escPosFooter(): string {
  let receipt = '\n\n';
  receipt += `${ESC}a1GRACIAS\n`;
  receipt += `${ESC}p0\x19\xFA`;
  receipt += `${GS}V\x41\x03`;
  return receipt;
}

export function buildCashCloseReceipt(
  tenant: { name: string; rnc?: string | null; phone?: string | null; address?: string | null },
  log: { expectedCash: number; countedCash: number; discrepancy: number; notes?: string | null; createdAt: Date },
  status: string,
  message: string,
): string {
  let receipt = escPosHeader(tenant);
  receipt += `${ESC}a1${ESC}E1CIERRE DE CAJA\n${ESC}E0`;
  receipt += `${ESC}a0`;
  receipt += `Fecha: ${log.createdAt.toLocaleString('es-DO')}\n`;
  receipt += '--------------------------------\n';
  receipt += `Esperado:  RD$ ${log.expectedCash.toFixed(2)}\n`;
  receipt += `Contado:   RD$ ${log.countedCash.toFixed(2)}\n`;
  receipt += `Diferencia: RD$ ${log.discrepancy.toFixed(2)}\n`;
  receipt += `Estado: ${status}\n`;
  receipt += `${message}\n`;
  if (log.notes) receipt += `Notas: ${log.notes}\n`;
  receipt += escPosFooter();
  return encodeEscPos(receipt);
}
