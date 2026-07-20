'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
// Replace with the real seeded tenantId after running seed
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || 'REPLACE_WITH_SEEDED_TENANT_ID';

// ──────────────────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────────────────
interface FinancialSummary {
  totalSales: number;
  grossRevenue: number;
  totalCost: number;
  netProfit: number;
  grossMarginPercent: number;
  totalItbis: number;
}

interface PurchaseSuggestion {
  productId: string;
  name: string;
  currentStock: number;
  dailyVelocity: number;
  unitsToOrder: number;
  estimatedCost: number;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

interface PurchaseList {
  totalProducts: number;
  totalEstimatedInvestment: number;
  suggestions: PurchaseSuggestion[];
}

interface TopProductEntry { name: string; totalQty: number; totalRevenue: number }
interface TopProducts { byVolume: TopProductEntry[]; byRevenue: TopProductEntry[] }

interface LowStockProduct {
  id: string; name: string; stock: number; urgency: string;
}

interface NcfRecord {
  id: string; ncf: string; ncfType: string; total: number; itbis: number;
  clientRnc: string | null; createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// METRIC CARD COMPONENT
// ──────────────────────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col gap-1">
      <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-black tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-slate-500 text-sm">{sub}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// URGENCY BADGE
// ──────────────────────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }: { urgency: string }) {
  const styles: Record<string, string> = {
    CRITICAL:     'bg-red-500/20 text-red-400 border border-red-500/30',
    HIGH:         'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    MEDIUM:       'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    OUT_OF_STOCK: 'bg-red-700/30 text-red-300 border border-red-700/40',
    LOW:          'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${styles[urgency] ?? styles.MEDIUM}`}>
      {urgency}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// SECTION HEADER
// ──────────────────────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-black text-white tracking-tight">{title}</h2>
      {subtitle && <p className="text-slate-400 text-sm mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN ADMIN DASHBOARD PAGE
// ──────────────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [finance, setFinance] = useState<FinancialSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [peakHours, setPeakHours] = useState<any[]>([]);
  const [purchaseList, setPurchaseList] = useState<PurchaseList | null>(null);
  const [lowStock, setLowStock] = useState<{ products: LowStockProduct[] } | null>(null);
  const [ncfLog, setNcfLog] = useState<NcfRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'fiscal'>('overview');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fin, top, peak, purchase, stock, ncf] = await Promise.all([
        fetch(`${API}/finance/daily?tenantId=${TENANT_ID}`).then((r) => r.json()),
        fetch(`${API}/analytics/top-products?tenantId=${TENANT_ID}`).then((r) => r.json()),
        fetch(`${API}/analytics/peak-hours?tenantId=${TENANT_ID}`).then((r) => r.json()),
        fetch(`${API}/analytics/purchase-list?tenantId=${TENANT_ID}`).then((r) => r.json()),
        fetch(`${API}/analytics/low-stock?tenantId=${TENANT_ID}`).then((r) => r.json()),
        fetch(`${API}/finance/ncf-log?tenantId=${TENANT_ID}`).then((r) => r.json()),
      ]);
      setFinance(fin);
      setTopProducts(top);
      setPeakHours(Array.isArray(peak) ? peak.filter((h: any) => h.salesCount > 0) : []);
      setPurchaseList(purchase);
      setLowStock(stock);
      setNcfLog(ncf?.records ?? []);
    } catch (err) {
      console.error('Dashboard fetch error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans">
      {/* ── HEADER ── */}
      <header className="bg-slate-900 border-b border-slate-800 px-8 py-4 flex items-center justify-between sticky top-0 z-40 shadow-xl">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            <span className="text-indigo-400">Mini</span>Market OS
            <span className="text-slate-500 font-normal text-lg ml-2">Admin</span>
          </h1>
        </div>
        <nav className="flex gap-2">
          {(['overview', 'inventory', 'fiscal'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-bold text-sm capitalize transition-colors ${
                activeTab === tab
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab === 'overview' ? '📊 Resumen' : tab === 'inventory' ? '📦 Inventario' : '🧾 Fiscal'}
            </button>
          ))}
        </nav>
        <button
          onClick={fetchAll}
          disabled={loading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors"
        >
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
      </header>

      <main className="px-6 py-8 max-w-screen-2xl mx-auto space-y-10">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <>
            {/* Financial Metrics */}
            <section>
              <SectionHeader title="Resumen Financiero de Hoy" subtitle="Actualizado en tiempo real desde PostgreSQL" />
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <MetricCard label="Ventas" value={finance?.totalSales ?? '—'} />
                <MetricCard
                  label="Ingresos Brutos"
                  value={`RD$ ${(finance?.grossRevenue ?? 0).toLocaleString()}`}
                  color="text-emerald-400"
                />
                <MetricCard
                  label="Costo Total"
                  value={`RD$ ${(finance?.totalCost ?? 0).toLocaleString()}`}
                  color="text-red-400"
                />
                <MetricCard
                  label="Ganancia Neta"
                  value={`RD$ ${(finance?.netProfit ?? 0).toLocaleString()}`}
                  color={finance?.netProfit && finance.netProfit > 0 ? 'text-emerald-400' : 'text-red-400'}
                />
                <MetricCard
                  label="Margen Bruto"
                  value={`${finance?.grossMarginPercent ?? 0}%`}
                  color="text-indigo-400"
                />
                <MetricCard
                  label="ITBIS 18%"
                  value={`RD$ ${(finance?.totalItbis ?? 0).toLocaleString()}`}
                  color="text-amber-400"
                  sub="Colectado DGII"
                />
              </div>
            </section>

            {/* Peak Hours */}
            <section>
              <SectionHeader
                title="Horas Pico de Ventas (Últimos 30 días)"
                subtitle="Optimiza tus cajeros y deliveries basado en estos datos"
              />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                {peakHours.length === 0 ? (
                  <p className="text-slate-500 text-center py-12">Sin datos de ventas todavía.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={peakHours} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                        labelStyle={{ color: '#94a3b8' }}
                        itemStyle={{ color: '#818cf8' }}
                      />
                      <Bar dataKey="salesCount" fill="#6366f1" radius={[4, 4, 0, 0]} name="Ventas" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            {/* Top Products */}
            <section>
              <SectionHeader title="Top 5 Productos" subtitle="Por volumen y por ingresos generados" />
              <div className="grid md:grid-cols-2 gap-6">
                {/* By Volume */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">🏆 Por Unidades Vendidas</h3>
                  <ul className="space-y-3">
                    {(topProducts?.byVolume ?? []).map((p, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="text-slate-600 font-black w-5">{i + 1}</span>
                        <div className="flex-1">
                          <div className="text-white font-semibold text-sm truncate">{p.name}</div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1">
                            <div
                              className="bg-indigo-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, (p.totalQty / (topProducts?.byVolume[0]?.totalQty || 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-indigo-400 font-black text-sm tabular-nums">{p.totalQty} uds</span>
                      </li>
                    ))}
                    {(!topProducts?.byVolume?.length) && (
                      <p className="text-slate-500 text-sm">Sin datos.</p>
                    )}
                  </ul>
                </div>
                {/* By Revenue */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                  <h3 className="text-slate-300 font-bold mb-4 flex items-center gap-2">💰 Por Ingresos Generados</h3>
                  <ul className="space-y-3">
                    {(topProducts?.byRevenue ?? []).map((p, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="text-slate-600 font-black w-5">{i + 1}</span>
                        <div className="flex-1">
                          <div className="text-white font-semibold text-sm truncate">{p.name}</div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1">
                            <div
                              className="bg-emerald-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(100, (p.totalRevenue / (topProducts?.byRevenue[0]?.totalRevenue || 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-emerald-400 font-black text-sm tabular-nums">
                          RD$ {p.totalRevenue.toLocaleString()}
                        </span>
                      </li>
                    ))}
                    {(!topProducts?.byRevenue?.length) && (
                      <p className="text-slate-500 text-sm">Sin datos.</p>
                    )}
                  </ul>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── INVENTORY TAB ── */}
        {activeTab === 'inventory' && (
          <>
            {/* Low Stock Alerts */}
            <section>
              <SectionHeader
                title={`Alertas de Stock Bajo (${lowStock?.products?.length ?? 0})`}
                subtitle="Productos con menos de 10 unidades en inventario"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(lowStock?.products ?? []).map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-xl p-5 border flex items-center justify-between ${
                      p.urgency === 'OUT_OF_STOCK'
                        ? 'bg-red-500/10 border-red-500/30'
                        : p.urgency === 'CRITICAL'
                        ? 'bg-orange-500/10 border-orange-500/30'
                        : 'bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div>
                      <p className="font-bold text-white">{p.name}</p>
                      <p className="text-4xl font-black tabular-nums mt-1 text-white">{p.stock}</p>
                      <p className="text-slate-400 text-xs mt-1">unidades restantes</p>
                    </div>
                    <UrgencyBadge urgency={p.urgency} />
                  </div>
                ))}
                {(!lowStock?.products?.length) && (
                  <p className="text-slate-500 col-span-full text-center py-16">
                    ✅ Todo el inventario está en niveles saludables.
                  </p>
                )}
              </div>
            </section>

            {/* AI Smart Purchase List */}
            <section>
              <SectionHeader
                title="🤖 Lista de Compras Inteligente (IA)"
                subtitle={
                  purchaseList
                    ? `${purchaseList.totalProducts} productos · Inversión estimada: RD$ ${purchaseList.totalEstimatedInvestment.toLocaleString()}`
                    : 'Calculando…'
                }
              />
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="text-left px-6 py-4 font-bold uppercase tracking-wider text-xs">Producto</th>
                      <th className="text-right px-4 py-4 font-bold uppercase tracking-wider text-xs">Stock Actual</th>
                      <th className="text-right px-4 py-4 font-bold uppercase tracking-wider text-xs">Velocidad/día</th>
                      <th className="text-right px-4 py-4 font-bold uppercase tracking-wider text-xs">Pedir</th>
                      <th className="text-right px-6 py-4 font-bold uppercase tracking-wider text-xs">Costo Est.</th>
                      <th className="text-center px-4 py-4 font-bold uppercase tracking-wider text-xs">Urgencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(purchaseList?.suggestions ?? []).map((s, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 font-semibold text-white">{s.name}</td>
                        <td className="px-4 py-4 text-right tabular-nums text-slate-300">{s.currentStock}</td>
                        <td className="px-4 py-4 text-right tabular-nums text-slate-300">{s.dailyVelocity}</td>
                        <td className="px-4 py-4 text-right tabular-nums font-black text-indigo-400 text-lg">{s.unitsToOrder}</td>
                        <td className="px-6 py-4 text-right tabular-nums text-emerald-400 font-bold">
                          RD$ {s.estimatedCost.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <UrgencyBadge urgency={s.urgency} />
                        </td>
                      </tr>
                    ))}
                    {(!purchaseList?.suggestions?.length) && (
                      <tr>
                        <td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                          ✅ Sin sugerencias de compra actualmente. Inventario en niveles óptimos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* ── FISCAL TAB ── */}
        {activeTab === 'fiscal' && (
          <section>
            <SectionHeader
              title="Registro de Comprobantes Fiscales (NCF)"
              subtitle="Todos los comprobantes emitidos · Listos para exportar al DGII"
            />
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="text-left px-6 py-4 font-bold uppercase tracking-wider text-xs">NCF</th>
                    <th className="text-left px-4 py-4 font-bold uppercase tracking-wider text-xs">Tipo</th>
                    <th className="text-left px-4 py-4 font-bold uppercase tracking-wider text-xs">RNC Cliente</th>
                    <th className="text-right px-4 py-4 font-bold uppercase tracking-wider text-xs">Total</th>
                    <th className="text-right px-4 py-4 font-bold uppercase tracking-wider text-xs">ITBIS</th>
                    <th className="text-left px-6 py-4 font-bold uppercase tracking-wider text-xs">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {ncfLog.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-indigo-300">{r.ncf}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            r.ncfType === 'CREDITO_FISCAL'
                              ? 'bg-blue-500/20 text-blue-400'
                              : r.ncfType === 'GUBERNAMENTAL'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {r.ncfType === 'CREDITO_FISCAL'
                            ? 'B01'
                            : r.ncfType === 'GUBERNAMENTAL'
                            ? 'B15'
                            : 'B02'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-400 font-mono">{r.clientRnc || '—'}</td>
                      <td className="px-4 py-4 text-right tabular-nums text-emerald-400 font-bold">
                        RD$ {r.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums text-amber-400">
                        RD$ {r.itbis.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-xs">
                        {new Date(r.createdAt).toLocaleString('es-DO')}
                      </td>
                    </tr>
                  ))}
                  {ncfLog.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                        No hay comprobantes fiscales emitidos todavía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
