'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch, apiDownload, LicenseBlockedError } from '../../../lib/api';
import { formatCurrency } from '../../../lib/format';
import { printDocument, escapeHtml } from '../../../lib/print';
import { AdminShell, MetricCard, Card } from '../../../components/admin/AdminShell';

type RangePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'custom';

interface PaymentBreakdown {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  count: number;
  total: number;
}

interface SalesReport {
  period: { from: string; to: string };
  totalSales: number;
  grossSales: number;
  netSales: number;
  itbisCollected: number;
  totalDiscount: number;
  totalCost: number;
  grossProfit: number;
  profitMargin: number;
  byPaymentMethod: PaymentBreakdown[];
}

interface TopProduct {
  productId: string;
  name: string;
  imageUrl: string | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
}

const PAYMENT_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  CASH: { label: 'Efectivo', icon: '💵', color: 'bg-emerald-500' },
  CARD: { label: 'Tarjeta', icon: '💳', color: 'bg-indigo-500' },
  TRANSFER: { label: 'Transferencia', icon: '🏦', color: 'bg-amber-500' },
};

interface DetailedRow { label: string; qty: number; salesCount: number; revenue: number; cost: number; profit: number; marginPct: number }
interface DetailedReport {
  groupBy: string;
  period: { from: string; to: string };
  rows: DetailedRow[];
  totals: { qty: number; salesCount: number; revenue: number; cost: number; profit: number; marginPct: number };
}
const DIMENSIONS: { value: string; label: string }[] = [
  { value: 'product', label: 'Producto' },
  { value: 'category', label: 'Categoría' },
  { value: 'zone', label: 'Zona' },
  { value: 'payment', label: 'Forma de pago' },
  { value: 'cashier', label: 'Cajero' },
  { value: 'ncfType', label: 'Tipo de comprobante' },
  { value: 'day', label: 'Día' },
];

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'last7', label: 'Últimos 7 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'custom', label: 'Personalizado' },
];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function resolveRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    case 'last7': {
      const from = new Date(now); from.setDate(from.getDate() - 6);
      return { from: startOfDay(from).toISOString(), to: endOfDay(now).toISOString() };
    }
    case 'thisMonth': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from).toISOString(), to: endOfDay(now).toISOString() };
    }
    case 'custom':
      return {
        from: customFrom ? startOfDay(new Date(customFrom)).toISOString() : startOfDay(now).toISOString(),
        to: customTo ? endOfDay(new Date(customTo)).toISOString() : endOfDay(now).toISOString(),
      };
  }
}

export default function ReportsPage() {
  const { user, setLicenseBlocked } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [preset, setPreset] = useState<RangePreset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Constructor de reportes avanzado ──
  const [dim, setDim] = useState('product');
  const [fCat, setFCat] = useState('');
  const [fZone, setFZone] = useState('');
  const [fPayment, setFPayment] = useState('');
  const [fCashier, setFCashier] = useState('');
  const [detail, setDetail] = useState<DetailedReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catOpts, setCatOpts] = useState<{ id: string; name: string }[]>([]);
  const [zoneOpts, setZoneOpts] = useState<{ id: string; name: string }[]>([]);
  const [cashierOpts, setCashierOpts] = useState<{ id: string; name: string }[]>([]);

  // Opciones de filtro (mejor esfuerzo: si falta permiso, el filtro queda vacío).
  useEffect(() => {
    if (!tenantId) return;
    apiFetch<{ id: string; name: string }[]>('/categories', tenantId).then(setCatOpts).catch(() => {});
    apiFetch<{ id: string; name: string }[]>('/zones', tenantId).then(setZoneOpts).catch(() => {});
    apiFetch<{ id: string; name: string; role?: string }[]>('/users', tenantId)
      .then((us) => setCashierOpts(us.filter((u) => !u.role || ['CASHIER', 'ADMIN', 'BILLER'].includes(u.role))))
      .catch(() => {});
  }, [tenantId]);

  const detailQuery = useCallback(() => {
    const { from, to } = resolveRange(preset, customFrom, customTo);
    const qs = new URLSearchParams({ from, to, groupBy: dim });
    if (fCat) qs.set('categoryId', fCat);
    if (fZone) qs.set('zoneId', fZone);
    if (fPayment) qs.set('paymentMethod', fPayment);
    if (fCashier) qs.set('cashierId', fCashier);
    return qs.toString();
  }, [preset, customFrom, customTo, dim, fCat, fZone, fPayment, fCashier]);

  const fetchDetail = useCallback(async () => {
    if (!tenantId) return;
    if (preset === 'custom' && (!customFrom || !customTo)) return;
    setDetailLoading(true);
    try {
      setDetail(await apiFetch<DetailedReport>(`/reports/detailed?${detailQuery()}`, tenantId));
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally { setDetailLoading(false); }
  }, [tenantId, preset, customFrom, customTo, detailQuery, setLicenseBlocked]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const exportDetail = async (format: 'csv' | 'xlsx') => {
    try { await apiDownload(`/reports/detailed/export?format=${format}&${detailQuery()}`, tenantId, `reporte.${format}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al exportar'); }
  };

  const fetchReports = useCallback(async () => {
    if (!tenantId) return;
    if (preset === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    setError('');
    try {
      const { from, to } = resolveRange(preset, customFrom, customTo);
      const [sales, products] = await Promise.all([
        apiFetch<SalesReport>(`/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, tenantId),
        apiFetch<TopProduct[]>(`/reports/top-products?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=10`, tenantId),
      ]);
      setReport(sales);
      setTopProducts(products);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
      else setError(err instanceof Error ? err.message : 'Error al cargar reportes');
    } finally {
      setLoading(false);
    }
  }, [tenantId, preset, customFrom, customTo, setLicenseBlocked]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const maxPaymentTotal = Math.max(1, ...(report?.byPaymentMethod ?? []).map((p) => p.total));
  const maxProductRevenue = Math.max(1, ...topProducts.map((p) => p.revenue));

  const exportPdf = () => {
    const paymentRows = (report?.byPaymentMethod ?? []).map((p) => `
      <tr><td>${PAYMENT_LABELS[p.method]?.label ?? p.method}</td><td class="num">${p.count}</td><td class="num">${formatCurrency(p.total)}</td></tr>`).join('');
    const productRows = topProducts.map((p, i) => `
      <tr><td>${i + 1}</td><td>${escapeHtml(p.name)}</td><td class="num">${p.qty % 1 === 0 ? p.qty : p.qty.toFixed(2)}</td><td class="num">${formatCurrency(p.revenue)}</td><td class="num">${formatCurrency(p.profit)}</td><td class="num">${p.marginPct.toFixed(1)}%</td></tr>`).join('');

    printDocument('Reporte de Ventas', `
      <div class="header"><div><h1>Reporte de Ventas</h1><p class="muted">${report?.period.from?.slice(0, 10) ?? ''} → ${report?.period.to?.slice(0, 10) ?? ''}</p></div></div>
      <div class="kpis">
        <div class="kpi"><div class="label">Ventas Brutas</div><div class="value">${formatCurrency(report?.grossSales)}</div></div>
        <div class="kpi"><div class="label">Ventas Netas</div><div class="value">${formatCurrency(report?.netSales)}</div></div>
        <div class="kpi"><div class="label">ITBIS</div><div class="value">${formatCurrency(report?.itbisCollected)}</div></div>
        <div class="kpi"><div class="label">Descuentos</div><div class="value">${formatCurrency(report?.totalDiscount)}</div></div>
        <div class="kpi"><div class="label">Costo de Productos</div><div class="value">${formatCurrency(report?.totalCost)}</div></div>
        <div class="kpi"><div class="label">Ganancia Estimada (Margen ${(report?.profitMargin ?? 0).toFixed(1)}%)</div><div class="value">${formatCurrency(report?.grossProfit)}</div></div>
      </div>
      <h2>Desglose por Método de Pago</h2>
      <table><thead><tr><th>Método</th><th class="num">Ventas</th><th class="num">Total</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="3" class="muted">Sin datos.</td></tr>'}</tbody></table>
      <h2>Productos Más Vendidos</h2>
      <table><thead><tr><th>#</th><th>Producto</th><th class="num">Unidades</th><th class="num">Ingresos</th><th class="num">Ganancia</th><th class="num">Margen</th></tr></thead><tbody>${productRows || '<tr><td colspan="6" class="muted">Sin datos.</td></tr>'}</tbody></table>
    `);
  };

  return (
    <AdminShell
      title="Reportes"
      subtitle="Análisis de ventas por periodo"
      actions={
        <>
          <button onClick={exportPdf} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">⬇ Exportar a PDF</button>
          <button onClick={fetchReports} disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            {loading ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </>
      }
    >
      {/* Date range selector */}
      <section className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => setPreset(p.id)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                preset === p.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
              }`}>{p.label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-indigo-400" />
            <span className="text-slate-400">→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-indigo-400" />
          </div>
        )}
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Ventas Brutas" value={formatCurrency(report?.grossSales)} sub="Antes de descuentos" />
        <MetricCard label="Ventas Netas" value={formatCurrency(report?.netSales)} accent="text-emerald-600" sub={`${report?.totalSales ?? 0} transacciones`} />
        <MetricCard label="ITBIS Recaudado" value={formatCurrency(report?.itbisCollected)} accent="text-amber-600" sub="18% DGII" />
        <MetricCard label="Descuentos Aplicados" value={formatCurrency(report?.totalDiscount)} accent="text-indigo-600" />
        <MetricCard label="Costo de Productos" value={formatCurrency(report?.totalCost)} accent="text-red-600" sub="Costo de mercancía vendida" />

        {/* High-visibility profit card with a prominent margin badge */}
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Ganancia Estimada</p>
            <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
              Margen: {(report?.profitMargin ?? 0).toFixed(1)}%
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-700">{formatCurrency(report?.grossProfit)}</p>
          <p className="mt-1 text-sm text-emerald-600">Ventas netas − costo de productos</p>
        </div>
      </section>

      {/* Payment method breakdown */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-slate-900">Desglose por Método de Pago</h2>
        <Card>
          {!report || report.byPaymentMethod.every((p) => p.count === 0) ? (
            <p className="py-10 text-center text-slate-400">No hay ventas registradas en este período.</p>
          ) : (
            <ul className="space-y-4">
              {report.byPaymentMethod.map((p) => {
                const meta = PAYMENT_LABELS[p.method] ?? { label: p.method, icon: '💰', color: 'bg-slate-400' };
                return (
                  <li key={p.method}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{meta.icon} {meta.label}</span>
                      <span className="tabular-nums text-slate-500">{p.count} venta(s) · <strong className="text-slate-900">{formatCurrency(p.total)}</strong></span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100">
                      <div className={`h-2.5 rounded-full ${meta.color}`} style={{ width: `${(p.total / maxPaymentTotal) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {/* Top products */}
      <section>
        <h2 className="mb-4 text-lg font-bold text-slate-900">Productos Más Vendidos</h2>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 text-left font-semibold">#</th>
                  <th className="px-4 py-3 text-left font-semibold">Producto</th>
                  <th className="px-4 py-3 text-right font-semibold">Unidades</th>
                  <th className="px-4 py-3 text-right font-semibold">Ingresos</th>
                  <th className="px-4 py-3 text-right font-semibold">Ganancia</th>
                  <th className="px-4 py-3 text-right font-semibold">Margen</th>
                  <th className="px-6 py-3 text-left font-semibold">Participación</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.productId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-3 font-bold text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.qty % 1 === 0 ? p.qty : p.qty.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">{formatCurrency(p.revenue)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-700">{formatCurrency(p.profit)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                        p.marginPct >= 30 ? 'bg-emerald-100 text-emerald-700' : p.marginPct >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {p.marginPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <div className="h-1.5 w-32 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(p.revenue / maxProductRevenue) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {topProducts.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-16 text-center text-slate-400">No hay ventas registradas en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Constructor de reportes avanzado ── */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">🔎 Reporte avanzado</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Exportar:</span>
            <button onClick={() => exportDetail('csv')} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">CSV</button>
            <button onClick={() => exportDetail('xlsx')} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Excel</button>
          </div>
        </div>

        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Agrupar por</label>
              <select value={dim} onChange={(e) => setDim(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {DIMENSIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Categoría</label>
              <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todas</option>
                {catOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Zona</label>
              <select value={fZone} onChange={(e) => setFZone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todas</option>
                {zoneOpts.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                <option value="NONE">Sin zona</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Forma de pago</label>
              <select value={fPayment} onChange={(e) => setFPayment(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todas</option>
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
                <option value="CREDIT">Crédito</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Cajero</label>
              <select value={fCashier} onChange={(e) => setFCashier(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Todos</option>
                {cashierOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">{DIMENSIONS.find((d) => d.value === dim)?.label}</th>
                  <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
                  <th className="px-4 py-3 text-right font-semibold">Ventas</th>
                  <th className="px-4 py-3 text-right font-semibold">Ingresos</th>
                  <th className="px-4 py-3 text-right font-semibold">Costo</th>
                  <th className="px-4 py-3 text-right font-semibold">Ganancia</th>
                  <th className="px-4 py-3 text-right font-semibold">Margen</th>
                </tr>
              </thead>
              <tbody>
                {detailLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Calculando…</td></tr>}
                {!detailLoading && (!detail || detail.rows.length === 0) && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Sin datos para los filtros seleccionados.</td></tr>
                )}
                {!detailLoading && detail?.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.qty % 1 === 0 ? r.qty : r.qty.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.salesCount}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-600">{formatCurrency(r.revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{formatCurrency(r.cost)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-700">{formatCurrency(r.profit)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                        r.marginPct >= 30 ? 'bg-emerald-100 text-emerald-700' : r.marginPct >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`}>{r.marginPct.toFixed(1)}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {!detailLoading && detail && detail.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-800">
                    <td className="px-4 py-3">TOTAL ({detail.totals.salesCount} venta{detail.totals.salesCount === 1 ? '' : 's'})</td>
                    <td className="px-4 py-3 text-right tabular-nums">{detail.totals.qty % 1 === 0 ? detail.totals.qty : detail.totals.qty.toFixed(2)}</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatCurrency(detail.totals.revenue)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-700">{formatCurrency(detail.totals.cost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(detail.totals.profit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{detail.totals.marginPct.toFixed(1)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </section>
    </AdminShell>
  );
}
