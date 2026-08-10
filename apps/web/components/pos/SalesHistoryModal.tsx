'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { printThermalReceiptHtml, type ThermalReceiptData } from '../../lib/thermal-receipt';

interface HistorySaleItem {
  quantity: number;
  price: number;
  product?: { name: string } | null;
}

interface HistorySale {
  id: string;
  invoiceNumber: string | null;
  ncf: string | null;
  ncfType: string;
  total: number;
  subtotal: number;
  itbis: number;
  applyItbis: boolean;
  totalReceived: number;
  totalChange: number;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
  status: string;
  clientName: string | null;
  createdAt: string;
  items: HistorySaleItem[];
}

interface SaleDetail extends HistorySale {
  tenant: {
    name: string;
    commercialName?: string | null;
    rnc?: string | null;
    address?: string | null;
    phone?: string | null;
    receiptFooter?: string | null;
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

interface SalesHistoryModalProps {
  isOpen: boolean;
  tenantId: string;
  cashierName?: string | null;
  onClose: () => void;
}

/**
 * "Historial de Ventas" — quick-access contingency panel so a cashier can
 * look up and reprint a recent sale (e.g. the thermal printer ran out of
 * paper) without leaving the POS terminal or going into /admin.
 */
export function SalesHistoryModal({ isOpen, tenantId, cashierName, onClose }: SalesHistoryModalProps) {
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reprintingId, setReprintingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadSales = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<HistorySale[]>(`/sales?limit=50`, tenantId);
      setSales(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial de ventas');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isOpen) loadSales();
  }, [isOpen, loadSales]);

  if (!isOpen) return null;

  const term = search.trim().toLowerCase();
  const filtered = term
    ? sales.filter(
        (s) =>
          (s.invoiceNumber ?? '').toLowerCase().includes(term) ||
          (s.ncf ?? '').toLowerCase().includes(term) ||
          (s.clientName ?? '').toLowerCase().includes(term),
      )
    : sales;

  const handleReprint = async (saleId: string) => {
    setReprintingId(saleId);
    try {
      const sale = await apiFetch<SaleDetail>(`/sales/${saleId}`, tenantId);
      const thermalData: ThermalReceiptData = {
        business: {
          name: sale.tenant.commercialName || sale.tenant.name,
          rnc: sale.tenant.rnc,
          address: sale.tenant.address,
          phone: sale.tenant.phone,
        },
        invoiceNumber: sale.invoiceNumber,
        ncf: sale.ncf,
        ncfType: sale.ncfType,
        date: new Date(sale.createdAt),
        cashierName,
        items: sale.items.map((item) => ({
          quantity: item.quantity,
          name: item.product?.name ?? 'Producto',
          unitPrice: item.price,
          total: parseFloat((item.price * item.quantity).toFixed(2)),
        })),
        subtotal: sale.subtotal,
        itbis: sale.itbis,
        applyItbis: sale.applyItbis,
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        totalReceived: sale.totalReceived,
        totalChange: sale.totalChange,
        footerMessage: sale.tenant.receiptFooter,
        offlineNotice: sale.status === 'VOIDED' ? 'FACTURA ANULADA — COPIA' : 'REIMPRESIÓN',
      };
      // Contingency reprint always goes through the HTML fallback — simple,
      // works regardless of whether a physical printer is connected right now.
      printThermalReceiptHtml(thermalData);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo reimprimir el recibo');
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">🧾 Historial de Ventas</h2>
            <p className="text-xs text-slate-500">Consulta y reimprime ventas recientes — útil si se acaba el papel</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        <div className="border-b border-slate-200 px-6 py-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por factura, NCF o cliente…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando historial…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No hay ventas registradas todavía</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((sale) => (
                <li key={sale.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {sale.invoiceNumber ?? 'Sin número'}
                      {sale.status === 'VOIDED' && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">ANULADA</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {new Date(sale.createdAt).toLocaleString('es-DO')} · {PAYMENT_LABELS[sale.paymentMethod] || sale.paymentMethod}
                      {sale.ncf && <> · NCF: {sale.ncf}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-bold tabular-nums text-indigo-600">RD$ {sale.total.toFixed(2)}</span>
                    <button
                      onClick={() => handleReprint(sale.id)}
                      disabled={reprintingId === sale.id}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {reprintingId === sale.id ? 'Imprimiendo…' : '🖨️ Reimprimir'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
