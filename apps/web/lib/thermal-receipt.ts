// 80mm thermal receipt HTML/CSS builder — used as the silent/window-print
// fallback when WebUSB and Web Serial printers are not available/paired.
// Optimized for POS80 (80mm paper, ~72mm printable area) thermal printers.

import { escapeHtml } from './print';

export interface ThermalReceiptItem {
  quantity: number;
  name: string;
  unitPrice: number;
  total: number;
}

export interface ThermalReceiptData {
  business: {
    name: string;
    rnc?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  invoiceNumber?: string | null;
  ncf?: string | null;
  ncfType?: string | null;
  date: Date;
  cashierName?: string | null;
  items: ThermalReceiptItem[];
  subtotal: number;
  itbis: number;
  applyItbis: boolean;
  total: number;
  paymentMethod: string;
  totalReceived: number;
  totalChange: number;
  footerMessage?: string | null;
  qrCodeUrl?: string | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

const THERMAL_80MM_STYLES = `
  * { box-sizing: border-box; }
  @page {
    size: 80mm auto;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 80mm;
  }
  body {
    font-family: 'Courier New', Consolas, monospace;
    font-size: 11px;
    line-height: 1.35;
    color: #000;
    padding: 2mm 4mm; /* ~72mm printable area inside the 80mm paper */
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .business-name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
  .muted { font-size: 10px; }
  .divider { border-top: 1px dashed #000; margin: 4px 0; }
  .divider-solid { border-top: 1px solid #000; margin: 4px 0; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 2px; }
  table.items th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  table.items td { font-size: 11px; padding: 1px 0; vertical-align: top; }
  table.items th.num, table.items td.num { text-align: right; }
  .item-name { word-break: break-word; }
  .totals-row { display: flex; justify-content: space-between; font-size: 11px; margin: 1px 0; }
  .totals-row.grand { font-size: 15px; font-weight: 700; margin-top: 4px; }
  .totals-row.change { font-size: 14px; font-weight: 700; background: #000; color: #fff; padding: 3px 4px; margin-top: 4px; }
  .totals-box { margin-top: 6px; }
  .footer { text-align: center; margin-top: 10px; font-size: 12px; font-weight: 700; }
  .footer .qr { margin-top: 8px; }
  .footer .qr img { width: 28mm; height: 28mm; }
  .footer .legal { margin-top: 6px; font-size: 9px; color: #333; }
`;

function money(n: number): string {
  return `RD$ ${n.toFixed(2)}`;
}

function buildItemsRows(items: ThermalReceiptItem[]): string {
  return items
    .map(
      (item) => `
      <tr>
        <td class="num">${item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}</td>
        <td class="item-name">${escapeHtml(item.name)}<br/><span class="muted">${money(item.unitPrice)} c/u</span></td>
        <td class="num">${money(item.total)}</td>
      </tr>`,
    )
    .join('');
}

export function buildThermalReceiptHtml(data: ThermalReceiptData): string {
  const paymentLabel = PAYMENT_LABELS[data.paymentMethod] || data.paymentMethod;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Recibo</title>
  <style>${THERMAL_80MM_STYLES}</style>
</head>
<body>
  <div class="center">
    <div class="business-name">${escapeHtml(data.business.name)}</div>
    ${data.business.rnc ? `<div class="muted">RNC: ${escapeHtml(data.business.rnc)}</div>` : ''}
    ${data.business.address ? `<div class="muted">${escapeHtml(data.business.address)}</div>` : ''}
    ${data.business.phone ? `<div class="muted">Tel: ${escapeHtml(data.business.phone)}</div>` : ''}
  </div>

  <div class="divider"></div>

  ${data.invoiceNumber ? `<div>Factura: <span class="bold">${escapeHtml(data.invoiceNumber)}</span></div>` : ''}
  ${data.ncf ? `<div>NCF: <span class="bold">${escapeHtml(data.ncf)}</span></div>` : ''}
  ${data.ncf && data.ncfType ? `<div class="muted">Tipo: ${escapeHtml(data.ncfType)}</div>` : ''}
  <div>Fecha: ${escapeHtml(data.date.toLocaleString('es-DO'))}</div>
  ${data.cashierName ? `<div>Cajero: ${escapeHtml(data.cashierName)}</div>` : ''}

  <div class="divider"></div>

  <table class="items">
    <thead>
      <tr>
        <th class="num">Cant</th>
        <th>Descripción</th>
        <th class="num">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${buildItemsRows(data.items)}
    </tbody>
  </table>

  <div class="divider"></div>

  <div class="totals-box">
    <div class="totals-row"><span>Subtotal</span><span>${money(data.subtotal)}</span></div>
    ${data.applyItbis ? `<div class="totals-row"><span>ITBIS (18%)</span><span>${money(data.itbis)}</span></div>` : ''}
    <div class="divider-solid"></div>
    <div class="totals-row grand"><span>TOTAL A PAGAR</span><span>${money(data.total)}</span></div>
    <div class="divider"></div>
    <div class="totals-row"><span>Forma de pago</span><span>${escapeHtml(paymentLabel)}</span></div>
    <div class="totals-row"><span>Monto recibido/entregado</span><span>${money(data.totalReceived)}</span></div>
    <div class="totals-row change"><span>CAMBIO / DEVUELTO</span><span>${money(data.totalChange)}</span></div>
  </div>

  <div class="footer">
    <div>${escapeHtml(data.footerMessage || '¡Gracias por su compra!')}</div>
    ${
      data.qrCodeUrl
        ? `<div class="qr"><img src="${escapeHtml(data.qrCodeUrl)}" alt="QR" /></div>`
        : ''
    }
    <div class="legal">MiniMarket OS</div>
  </div>
</body>
</html>`;
}

/**
 * Opens a print-only popup window sized/styled for 80mm thermal paper and
 * triggers the browser print dialog (silent/window printing fallback when no
 * WebUSB or Web Serial printer is connected/paired).
 */
export function printThermalReceiptHtml(data: ThermalReceiptData): void {
  if (typeof window === 'undefined') return;
  const win = window.open('', '_blank', 'width=360,height=640');
  if (!win) {
    alert('Habilita las ventanas emergentes para imprimir el recibo.');
    return;
  }
  win.document.write(buildThermalReceiptHtml(data));
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 300);
}
