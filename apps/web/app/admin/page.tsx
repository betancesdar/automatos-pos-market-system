'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, downloadFile, LicenseBlockedError } from '../../lib/api';
import { AddProductModal, type ProductFormData } from '../../components/admin/AddProductModal';
import { TenantSettingsPanel } from '../../components/admin/TenantSettingsPanel';
import { EmployeesPanel } from '../../components/admin/EmployeesPanel';
import { CashCloseModal } from '../../components/admin/CashCloseModal';
import { ReceiptPrinter } from '../../components/ReceiptPrinter';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Tab = 'overview' | 'inventory' | 'fiscal' | 'settings' | 'employees';

interface FinancialSummary {
  totalSales: number;
  grossRevenue: number;
  totalCost: number;
  netProfit: number;
  grossMarginPercent: number;
  totalItbis: number;
  cashDrawerLogs?: { id: string; expectedCash: number; countedCash: number; discrepancy: number; createdAt: string }[];
}

interface Product {
  id: string; name: string; barcode: string | null; price: number; cost: number; stock: number;
  imageUrl: string | null;
  category?: { id: string; name: string; slug: string } | null;
}

interface PurchaseSuggestion {
  productId: string; name: string; currentStock: number; dailyVelocity: number;
  unitsToOrder: number; estimatedCost: number; urgency: string;
}

interface PurchaseList { totalProducts: number; totalEstimatedInvestment: number; suggestions: PurchaseSuggestion[] }
interface TopProductEntry { name: string; totalQty: number; totalRevenue: number }
interface TopProducts { byVolume: TopProductEntry[]; byRevenue: TopProductEntry[] }
interface LowStockProduct { id: string; name: string; stock: number; urgency: string }
interface NcfRecord { id: string; ncf: string; ncfType: string; total: number; itbis: number; clientRnc: string | null; createdAt: string }

function MetricCard({ label, value, sub, accent = 'text-slate-900' }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

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

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>{children}</div>;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Resumen' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'settings', label: 'Configuración' },
  { id: 'employees', label: 'Empleados' },
];

export default function AdminDashboard() {
  const { user, logout, setLicenseBlocked } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [finance, setFinance] = useState<FinancialSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProducts | null>(null);
  const [peakHours, setPeakHours] = useState<{ label: string; salesCount: number }[]>([]);
  const [purchaseList, setPurchaseList] = useState<PurchaseList | null>(null);
  const [lowStock, setLowStock] = useState<{ products: LowStockProduct[] } | null>(null);
  const [ncfLog, setNcfLog] = useState<NcfRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showCashClose, setShowCashClose] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [fin, top, peak, purchase, stock, ncf, prods] = await Promise.all([
        apiFetch<FinancialSummary>('/finance/daily', tenantId),
        apiFetch<TopProducts>('/analytics/top-products', tenantId),
        apiFetch<{ label: string; salesCount: number }[]>('/analytics/peak-hours', tenantId),
        apiFetch<PurchaseList>('/analytics/purchase-list', tenantId),
        apiFetch<{ products: LowStockProduct[] }>('/analytics/low-stock', tenantId),
        apiFetch<{ records: NcfRecord[] }>('/finance/ncf-log', tenantId),
        apiFetch<Product[]>('/catalog/products', tenantId),
      ]);
      setFinance(fin);
      setTopProducts(top);
      setPeakHours(Array.isArray(peak) ? peak.filter((h) => h.salesCount > 0) : []);
      setPurchaseList(purchase);
      setLowStock(stock);
      setNcfLog(ncf?.records ?? []);
      setProducts(prods);
    } catch (err) {
      if (err instanceof LicenseBlockedError) {
        setLicenseBlocked(err.message);
      } else {
        console.error('Dashboard fetch error', err);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantId, setLicenseBlocked]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleAddProduct = async (data: ProductFormData) => {
    await apiFetch('/catalog/product', tenantId, {
      method: 'POST',
      body: JSON.stringify({
        barcode: data.barcode || undefined,
        name: data.name,
        price: data.price,
        cost: data.cost,
        stock: data.stock,
        categoryId: data.categoryId,
        imageUrl: data.imageUrl || undefined,
      }),
    });
    await fetchAll();
  };

  const handleExport607 = async (format: 'json' | 'csv') => {
    setExporting(true);
    try {
      const res = await fetch(`/api/proxy/finance/report/607/export?tenantId=${tenantId}&format=${format}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (format === 'csv') {
        downloadFile(data.content, data.filename, 'text/csv');
      } else {
        downloadFile(JSON.stringify(data.content, null, 2), data.filename, 'application/json');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al exportar');
    } finally {
      setExporting(false);
    }
  };

  const expectedCashToday = finance?.cashDrawerLogs?.length
    ? undefined
    : finance?.grossRevenue;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <ReceiptPrinter />

      <AddProductModal isOpen={showAddProduct} tenantId={tenantId} onClose={() => setShowAddProduct(false)} onSave={handleAddProduct} />
      <CashCloseModal
        isOpen={showCashClose}
        tenantId={tenantId}
        expectedCash={finance?.grossRevenue}
        onClose={() => setShowCashClose(false)}
        onSuccess={fetchAll}
      />

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-indigo-600">Mini</span>Market OS
              <span className="ml-2 text-base font-normal text-slate-500">Admin</span>
            </h1>
            {user && <p className="text-xs text-slate-400">{user.name} · {user.role}</p>}
          </div>

          <nav className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex gap-2">
            <button
              onClick={() => setShowCashClose(true)}
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              Cierre de Caja
            </button>
            <button
              onClick={fetchAll}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-8 px-6 py-8">

        {activeTab === 'overview' && (
          <>
            <section>
              <SectionHeader title="Resumen Financiero de Hoy" subtitle="Actualizado en tiempo real desde PostgreSQL" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <MetricCard label="Ingresos" value={`RD$ ${(finance?.grossRevenue ?? 0).toLocaleString()}`} accent="text-emerald-600" />
                <MetricCard label="Costos" value={`RD$ ${(finance?.totalCost ?? 0).toLocaleString()}`} accent="text-red-600" />
                <MetricCard label="Margen" value={`${finance?.grossMarginPercent ?? 0}%`} accent="text-indigo-600"
                  sub={`Ganancia: RD$ ${(finance?.netProfit ?? 0).toLocaleString()}`} />
                <MetricCard label="ITBIS" value={`RD$ ${(finance?.totalItbis ?? 0).toLocaleString()}`} accent="text-amber-600" sub="Colectado DGII · 18%" />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetricCard label="Ventas del día" value={finance?.totalSales ?? '—'} />
                <MetricCard label="Ganancia Neta" value={`RD$ ${(finance?.netProfit ?? 0).toLocaleString()}`}
                  accent={finance?.netProfit && finance.netProfit > 0 ? 'text-emerald-600' : 'text-red-600'} />
              </div>
            </section>

            {finance?.cashDrawerLogs && finance.cashDrawerLogs.length > 0 && (
              <section>
                <SectionHeader title="Cierres de Caja Recientes" />
                <Panel>
                  <ul className="space-y-2 text-sm">
                    {finance.cashDrawerLogs.map((log) => (
                      <li key={log.id} className="flex justify-between border-b border-slate-100 py-2">
                        <span className="text-slate-500">{new Date(log.createdAt).toLocaleString('es-DO')}</span>
                        <span className={log.discrepancy === 0 ? 'text-emerald-600' : log.discrepancy > 0 ? 'text-amber-600' : 'text-red-600'}>
                          Dif: RD$ {log.discrepancy.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </section>
            )}

            <section>
              <SectionHeader title="Horas Pico de Ventas" subtitle="Últimos 30 días" />
              <Panel>
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
              </Panel>
            </section>

            <section>
              <SectionHeader title="Top 5 Productos" />
              <div className="grid gap-6 md:grid-cols-2">
                <Panel>
                  <h3 className="mb-4 text-sm font-semibold text-slate-700">Por Unidades Vendidas</h3>
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
                  </ul>
                </Panel>
                <Panel>
                  <h3 className="mb-4 text-sm font-semibold text-slate-700">Por Ingresos</h3>
                  <ul className="space-y-3">
                    {(topProducts?.byRevenue ?? []).map((p, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="w-5 text-sm font-bold text-slate-400">{i + 1}</span>
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</div>
                        <span className="text-sm font-semibold text-emerald-600">RD$ {p.totalRevenue.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </section>
          </>
        )}

        {activeTab === 'inventory' && (
          <>
            <div className="flex items-center justify-between">
              <SectionHeader title="Inventario" subtitle={`${products.length} productos registrados`} />
              <button
                onClick={() => setShowAddProduct(true)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                + Agregar Producto
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-6 py-3 text-left font-semibold">Producto</th>
                    <th className="px-4 py-3 text-left font-semibold">Código</th>
                    <th className="px-4 py-3 text-right font-semibold">Precio</th>
                    <th className="px-4 py-3 text-right font-semibold">Stock</th>
                    <th className="px-4 py-3 text-left font-semibold">Categoría</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.barcode || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">RD$ {p.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={p.stock <= 10 ? 'font-bold text-red-600' : 'text-slate-700'}>{p.stock}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{p.category?.name || '—'}</td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">No hay productos. Agrega el primero.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <section>
              <SectionHeader title={`Alertas de Stock Bajo (${lowStock?.products?.length ?? 0})`} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(lowStock?.products ?? []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-3xl font-bold tabular-nums">{p.stock}</p>
                    </div>
                    <UrgencyBadge urgency={p.urgency} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionHeader title="Lista de Compras Inteligente"
                subtitle={purchaseList ? `${purchaseList.totalProducts} productos · RD$ ${purchaseList.totalEstimatedInvestment.toLocaleString()}` : ''} />
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-6 py-3 text-left font-semibold">Producto</th>
                      <th className="px-4 py-3 text-right font-semibold">Stock</th>
                      <th className="px-4 py-3 text-right font-semibold">Pedir</th>
                      <th className="px-4 py-3 text-center font-semibold">Urgencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(purchaseList?.suggestions ?? []).map((s, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="px-6 py-3 font-medium">{s.name}</td>
                        <td className="px-4 py-3 text-right">{s.currentStock}</td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-600">{s.unitsToOrder}</td>
                        <td className="px-4 py-3 text-center"><UrgencyBadge urgency={s.urgency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'fiscal' && (
          <section className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <SectionHeader title="Registro NCF" subtitle="Comprobantes fiscales emitidos" />
              <div className="flex gap-2">
                <button
                  onClick={() => handleExport607('csv')}
                  disabled={exporting}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Exportar Formato 607 (CSV)
                </button>
                <button
                  onClick={() => handleExport607('json')}
                  disabled={exporting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Exportar Formato 607 (JSON)
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">RD$ {r.total.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-amber-600">RD$ {r.itbis.toFixed(2)}</td>
                      <td className="px-6 py-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString('es-DO')}</td>
                    </tr>
                  ))}
                  {ncfLog.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-400">No hay comprobantes emitidos.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'settings' && (
          <section>
            <SectionHeader title="Configuración de Negocio" subtitle="Personaliza los datos de tu colmado y secuencias NCF" />
            <TenantSettingsPanel tenantId={tenantId} />
          </section>
        )}

        {activeTab === 'employees' && (
          <section>
            <SectionHeader title="Gestión de Empleados" subtitle="Crea y administra usuarios con roles ADMIN o CAJERO" />
            <EmployeesPanel tenantId={tenantId} />
          </section>
        )}
      </main>
    </div>
  );
}
