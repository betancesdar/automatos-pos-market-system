'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch, LicenseBlockedError } from '../../../lib/api';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { printDocument, escapeHtml } from '../../../lib/print';
import { AdminShell, StatusBadge, MetricCard } from '../../../components/admin/AdminShell';

interface SaleItem {
  id: string;
  quantity: number;
  price: number;
  product?: { name: string } | null;
}

interface Sale {
  id: string;
  invoiceNumber: string | null;
  total: number;
  subtotal: number;
  itbis: number;
  totalReceived: number;
  totalChange: number;
  ncf: string | null;
  ncfType: string;
  clientRnc: string | null;
  clientName: string | null;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
  status: string;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  items: SaleItem[];
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Todas' },
  { value: 'COMPLETED', label: 'Completadas' },
  { value: 'VOIDED', label: 'Anuladas' },
];

export default function SalesPage() {
  const { user, setLicenseBlocked } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [detail, setDetail] = useState<Sale | null>(null);
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status !== 'ALL') params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      const data = await apiFetch<Sale[]>(`/sales${qs ? `?${qs}` : ''}`, tenantId);
      setSales(data);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, search, status, from, to, setLicenseBlocked]);

  useEffect(() => { load(); }, [load]);

  const completed = sales.filter((s) => s.status !== 'VOIDED');
  const voided = sales.filter((s) => s.status === 'VOIDED');
  const totalRevenue = completed.reduce((s, x) => s + x.total, 0);

  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) { setVoidError('Debe indicar el motivo de la anulación'); return; }
    setVoiding(true);
    setVoidError('');
    try {
      await apiFetch(`/sales/${voidTarget.id}/void`, tenantId, {
        method: 'POST',
        body: JSON.stringify({ voidReason: voidReason.trim() }),
      });
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'No se pudo anular la factura');
    } finally {
      setVoiding(false);
    }
  };

  const exportInvoicePdf = (sale: Sale) => {
    const rows = sale.items.map((it) => `
      <tr>
        <td>${escapeHtml(it.product?.name ?? '—')}</td>
        <td class="num">${it.quantity}</td>
        <td class="num">${formatCurrency(it.price)}</td>
        <td class="num">${formatCurrency(it.price * it.quantity)}</td>
      </tr>`).join('');

    printDocument(`Factura ${sale.invoiceNumber ?? sale.id}`, `
      <div class="header">
        <div>
          <h1>Factura ${escapeHtml(sale.invoiceNumber ?? '')}</h1>
          <p class="muted">${formatDateTime(sale.createdAt)}</p>
          ${sale.ncf ? `<p class="muted"><strong>Factura de Crédito Fiscal</strong><br />NCF: ${escapeHtml(sale.ncf)}</p>` : ''}
        </div>
        <div>
          <span class="badge ${sale.status === 'VOIDED' ? 'badge-red' : 'badge-green'}">
            ${sale.status === 'VOIDED' ? 'ANULADA' : 'COMPLETADA'}
          </span>
        </div>
      </div>
      ${sale.clientName || sale.clientRnc ? `<p><strong>Cliente:</strong> ${escapeHtml(sale.clientName ?? '')} ${sale.clientRnc ? `(RNC ${escapeHtml(sale.clientRnc)})` : ''}</p>` : ''}
      <table>
        <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="kpis" style="margin-top:24px;">
        <div class="kpi"><div class="label">Subtotal</div><div class="value">${formatCurrency(sale.subtotal)}</div></div>
        <div class="kpi"><div class="label">ITBIS</div><div class="value">${formatCurrency(sale.itbis)}</div></div>
        <div class="kpi"><div class="label">Total</div><div class="value">${formatCurrency(sale.total)}</div></div>
        <div class="kpi"><div class="label">Total Recibido</div><div class="value">${formatCurrency(sale.totalReceived)}</div></div>
        <div class="kpi"><div class="label">Cambio / Devuelto</div><div class="value">${formatCurrency(sale.totalChange)}</div></div>
        <div class="kpi"><div class="label">Método de pago</div><div class="value">${PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</div></div>
      </div>
      ${sale.status === 'VOIDED' ? `<p style="color:#991b1b;margin-top:16px;"><strong>Motivo de anulación:</strong> ${escapeHtml(sale.voidReason ?? '')}</p>` : ''}
    `);
  };

  const exportListPdf = () => {
    const rows = sales.map((s) => `
      <tr>
        <td>${escapeHtml(s.invoiceNumber ?? '')}</td>
        <td>${formatDateTime(s.createdAt)}</td>
        <td>${escapeHtml(s.ncf ?? '—')}</td>
        <td>${escapeHtml(s.clientName ?? '—')}</td>
        <td>${PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}</td>
        <td><span class="badge ${s.status === 'VOIDED' ? 'badge-red' : 'badge-green'}">${s.status === 'VOIDED' ? 'ANULADA' : 'COMPLETADA'}</span></td>
        <td class="num">${formatCurrency(s.total)}</td>
      </tr>`).join('');

    printDocument('Historial de Facturas', `
      <div class="header">
        <div><h1>Historial de Facturas</h1><p class="muted">${sales.length} registros</p></div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Facturas válidas</div><div class="value">${completed.length}</div></div>
        <div class="kpi"><div class="label">Anuladas</div><div class="value">${voided.length}</div></div>
        <div class="kpi"><div class="label">Ingresos válidos</div><div class="value">${formatCurrency(totalRevenue)}</div></div>
      </div>
      <table>
        <thead><tr><th>Factura</th><th>Fecha</th><th>NCF</th><th>Cliente</th><th>Pago</th><th>Estado</th><th class="num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  };

  return (
    <AdminShell
      title="Facturas & Ventas"
      subtitle="Historial, búsqueda y anulación de comprobantes"
      actions={
        <button onClick={exportListPdf} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
          ⬇ Exportar a PDF
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Facturas válidas" value={completed.length} icon="🧾" accent="text-emerald-600" />
        <MetricCard label="Anuladas" value={voided.length} icon="🚫" accent="text-red-600" />
        <MetricCard label="Ingresos válidos" value={formatCurrency(totalRevenue)} icon="💰" />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-500">Buscar</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="No. Factura, NCF, cliente o RNC…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Estado</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400">
              {STATUS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
          </div>
          {(search || from || to || status !== 'ALL') && (
            <button
              onClick={() => { setSearch(''); setFrom(''); setTo(''); setStatus('ALL'); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 text-left font-semibold">Factura</th>
                <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                <th className="px-4 py-3 text-left font-semibold">NCF</th>
                <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                <th className="px-4 py-3 text-left font-semibold">Pago</th>
                <th className="px-4 py-3 text-center font-semibold">Estado</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                  <td className="px-6 py-3 font-mono font-semibold text-indigo-600">{s.invoiceNumber ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(s.createdAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{s.ncf ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.clientName ?? (s.clientRnc ? `RNC ${s.clientRnc}` : '—')}</td>
                  <td className="px-4 py-3 text-slate-600">{PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={s.status} /></td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${s.status === 'VOIDED' ? 'text-slate-400 line-through' : 'text-emerald-600'}`}>
                    {formatCurrency(s.total)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setDetail(s)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">Ver</button>
                      <button onClick={() => exportInvoicePdf(s)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">PDF</button>
                      {s.status !== 'VOIDED' && (
                        <button onClick={() => { setVoidError(''); setVoidReason(''); setVoidTarget(s); }}
                          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Anular</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-slate-400">
                  {loading ? 'Cargando…' : 'No hay facturas que coincidan con los filtros.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Detail modal ── */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Factura {detail.invoiceNumber}</h2>
                <p className="text-sm text-slate-500">{formatDateTime(detail.createdAt)}</p>
              </div>
              <StatusBadge status={detail.status} />
            </div>
            <div className="space-y-4 px-6 py-5">
              {detail.status === 'VOIDED' && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <strong>Anulada:</strong> {detail.voidReason} · {formatDateTime(detail.voidedAt)}
                </div>
              )}
              {detail.ncf && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Factura de Crédito Fiscal</p>
                  <p className="mt-1 font-mono text-sm font-bold text-indigo-900">NCF: {detail.ncf}</p>
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 font-semibold">Producto</th>
                    <th className="py-2 text-right font-semibold">Cant.</th>
                    <th className="py-2 text-right font-semibold">Precio</th>
                    <th className="py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-100">
                      <td className="py-2">{it.product?.name ?? '—'}</td>
                      <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(it.price)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(it.price * it.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-1 border-t border-slate-200 pt-3 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{formatCurrency(detail.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">ITBIS</span><span className="tabular-nums">{formatCurrency(detail.itbis)}</span></div>
                <div className="flex justify-between text-base font-bold"><span>Total</span><span className="tabular-nums">{formatCurrency(detail.total)}</span></div>
                <div className="mt-2 flex justify-between border-t border-slate-100 pt-2"><span className="font-medium text-slate-600">Total Recibido</span><span className="font-semibold tabular-nums">{formatCurrency(detail.totalReceived)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Cambio / Devuelto</span><span className="tabular-nums text-emerald-600">{formatCurrency(detail.totalChange)}</span></div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setDetail(null)} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50">Cerrar</button>
                <button onClick={() => exportInvoicePdf(detail)} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500">Exportar PDF</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Void modal ── */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-red-600">Anular Factura {voidTarget.invoiceNumber}</h2>
              <p className="text-sm text-slate-500">Se restaurará el stock de los productos vendidos.</p>
            </div>
            <div className="space-y-4 px-6 py-5">
              {voidError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{voidError}</div>}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Motivo de la anulación *</label>
                <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={3} autoFocus
                  placeholder="Ej: Error de digitación, devolución del cliente…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-400" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setVoidTarget(null)} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={confirmVoid} disabled={voiding} className="flex-1 rounded-lg bg-red-600 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                  {voiding ? 'Anulando…' : 'Confirmar Anulación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
