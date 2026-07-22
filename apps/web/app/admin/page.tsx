'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, downloadFile, LicenseBlockedError } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { AdminShell, MetricCard, Card } from '../../components/admin/AdminShell';
import { ReceiptPrinter } from '../../components/ReceiptPrinter';

interface FinancialSummary {
  totalSales: number;
  grossRevenue: number;
  totalCost: number;
  netProfit: number;
  grossMarginPercent: number;
  totalItbis: number;
  cashDrawerLogs?: { id: string; expectedCash: number; countedCash: number; discrepancy: number; createdAt: string }[];
}

interface TopProductEntry { name: string; totalQty: number; totalRevenue: number }
interface TopProducts { byVolume: TopProductEntry[]; byRevenue: TopProductEntry[] }
interface LowStockProduct { id: string; name: string; stock: number; urgency: string }
interface NcfRecord { id: string; ncf: string; ncfType: string; total: number; itbis: number; clientRnc: string | null; createdAt: string }

function UrgencyBadge({ urgency }: { urgency: string }) {
  const styles: Record<string, string> = {
    CRITICAL: 'bg-red-50 text-red-700 border-red-200',
    HIGH: 'bg-orange-50 text-orange-700 border-orange-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    OUT_OF_STOCK: 'bg-red-100 text-red-800 border-red-300',
    LOW: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  };
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${styles[urgency] ?? styles.MEDIUM}`}>
      {urgency}
    </span>
  );
}

export default function AdminDashboard() {
  const { user, setLicenseBlocked } = useAuth();
  const router = useRouter();
  const tenantId = user?.tenantId ?? '';

  const [finance, setFinance] = useState<FinancialSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [peakHours, setPeakHours] = useState<{ label: string; salesCount: number }[]>([]);
  const [lowStock, setLowStock] = useState<{ products: LowStockProduct[] } | null>(null);
  const [ncfLog, setNcfLog] = useState<NcfRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [fin, top, peak, stock, ncf] = await Promise.all([
        apiFetch<FinancialSummary>('/finance/daily', tenantId),
        apiFetch<TopProducts>('/analytics/top-products', tenantId),
        apiFetch<{ label: string; salesCount: number }[]>('/analytics/peak-hours', tenantId),
        apiFetch<{ products: LowStockProduct[] }>('/analytics/low-stock', tenantId),
        apiFetch<{ records: NcfRecord[] }>('/finance/ncf-log', tenantId),
      ]);
      setFinance(fin);
      setTopProducts(top);
      setPeakHours(Array.isArray(peak) ? peak.filter((h) => h.salesCount > 0) : []);
      setLowStock(stock);
      setNcfLog(ncf?.records ?? []);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
      else console.error('Dashboard fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId, setLicenseBlocked]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleExport607 = async (format: 'json' | 'csv') => {
    setExporting(true);
    try {
      const res = await fetch(`/api/proxy/finance/report/607/export?tenantId=${tenantId}&format=${format}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (format === 'csv') downloadFile(data.content, data.filename, 'text/csv');
      else downloadFile(JSON.stringify(data.content, null, 2), data.filename, 'application/json');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al exportar');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminShell
      title="Resumen"
      subtitle="Vista general del negocio · hoy"
      actions={
        <button
          onClick={fetchAll}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
      }
    >
      <ReceiptPrinter />

      {/* KPIs */}
      <section>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="Ingresos Brutos" value={formatCurrency(finance?.grossRevenue)} accent="text-emerald-600" icon="💰" />
          <MetricCard label="Costos" value={formatCurrency(finance?.totalCost)} accent="text-red-600" icon="📉" />
          <MetricCard label="Margen de Ganancia" value={`${finance?.grossMarginPercent ?? 0}%`} accent="text-indigo-600"
            sub={`Ganancia: ${formatCurrency(finance?.netProfit)}`} icon="📈" />
          <MetricCard label="ITBIS Colectado" value={formatCurrency(finance?.totalItbis)} accent="text-amber-600" sub="DGII · 18%" icon="🧾" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard label="Ventas del día" value={finance?.totalSales ?? '—'} icon="🛒" />
          <MetricCard label="Ganancia Neta" value={formatCurrency(finance?.netProfit)}
            accent={finance?.netProfit && finance.netProfit > 0 ? 'text-emerald-600' : 'text-red-600'} icon="✨" />
        </div>
      </section>

      {/* Quick links */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { href: '/admin/inventory', label: 'Inventario', icon: '📦' },
          { href: '/admin/sales', label: 'Facturas', icon: '🧾' },
          { href: '/admin/shifts', label: 'Turnos & Caja', icon: '💵' },
          { href: '/admin/reports', label: 'Reportes', icon: '📈' },
        ].map((l) => (
          <button key={l.href} onClick={() => router.push(l.href)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md">
            <span className="text-2xl">{l.icon}</span>
            <span className="text-sm font-semibold text-slate-700">{l.label}</span>
          </button>
        ))}
      </section>

      {/* Peak hours */}
      <section>
        <h3 className="mb-4 text-lg font-bold text-slate-900">Horas Pico de Ventas <span className="text-sm font-normal text-slate-400">· últimos 30 días</span></h3>
        <Card>
          {peakHours.length === 0 ? (
            <p className="py-12 text-center text-slate-400">Sin datos de ventas todavía.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={peakHours} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                <Bar dataKey="salesCount" fill="#6366f1" radius={[4, 4, 0, 0]} name="Ventas" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </section>

      {/* Top products + low stock */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Top Productos por Unidades</h3>
          <ul className="space-y-3">
            {(topProducts?.byVolume ?? []).map((p, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="w-5 text-sm font-bold text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(100, (p.totalQty / (topProducts?.byVolume[0]?.totalQty || 1)) * 100)}%` }} />
                  </div>
                </div>
                <span className="text-sm font-semibold text-indigo-600">{p.totalQty} uds</span>
              </li>
            ))}
            {(topProducts?.byVolume?.length ?? 0) === 0 && <p className="py-6 text-center text-slate-400">Sin datos.</p>}
          </ul>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Alertas de Stock Bajo ({lowStock?.products?.length ?? 0})</h3>
          <ul className="space-y-2">
            {(lowStock?.products ?? []).slice(0, 8).map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <span className="text-sm font-medium">{p.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold tabular-nums">{p.stock}</span>
                  <UrgencyBadge urgency={p.urgency} />
                </div>
              </li>
            ))}
            {(lowStock?.products?.length ?? 0) === 0 && <p className="py-6 text-center text-slate-400">Todo el inventario está saludable.</p>}
          </ul>
        </Card>
      </section>

      {/* Fiscal / NCF */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">Registro NCF <span className="text-sm font-normal text-slate-400">· comprobantes fiscales</span></h3>
          <div className="flex gap-2">
            <button onClick={() => handleExport607('csv')} disabled={exporting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50">
              Formato 607 (CSV)
            </button>
            <button onClick={() => handleExport607('json')} disabled={exporting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              Formato 607 (JSON)
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 text-left font-semibold">NCF</th>
                  <th className="px-4 py-3 text-left font-semibold">Tipo</th>
                  <th className="px-4 py-3 text-left font-semibold">RNC Cliente</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-right font-semibold">ITBIS</th>
                  <th className="px-6 py-3 text-left font-semibold">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {ncfLog.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-3 font-mono font-semibold text-indigo-600">{r.ncf}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                        {r.ncfType === 'CREDITO_FISCAL' ? 'B01' : r.ncfType === 'GUBERNAMENTAL' ? 'B15' : 'B02'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{r.clientRnc || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{formatCurrency(r.total)}</td>
                    <td className="px-4 py-3 text-right text-amber-600">{formatCurrency(r.itbis)}</td>
                    <td className="px-6 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString('es-DO')}</td>
                  </tr>
                ))}
                {ncfLog.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-400">No hay comprobantes emitidos.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
