'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { AdminShell, MetricCard, Card } from '../../../components/admin/AdminShell';
import { RegisterInvoiceModal } from '../../../components/admin/RegisterInvoiceModal';

interface Supplier {
  id: string; name: string; rnc: string | null; phone: string | null; email: string | null;
  address: string | null; balance: string; active: boolean; notes: string | null;
}
interface InvoiceRow {
  id: string; invoiceNumber: string; ncf: string | null; date: string;
  total: string; balance: string; status: string;
  supplier: { id: string; name: string; rnc: string | null };
}
interface Payment { id: string; amount: string; method: string; note: string | null; createdAt: string }
interface InvoiceItem { id: string; rawName: string; quantity: number; unitCost: string; total: string; product: { id: string; name: string } | null }
interface InvoiceDetail extends InvoiceRow { items: InvoiceItem[]; payments: Payment[]; dueDate: string | null; notes: string | null }
interface Dashboard { totalPayable: string; overduePayable: string; activeSuppliers: number; recentInvoices: InvoiceRow[] }

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700', PARTIAL: 'bg-blue-100 text-blue-700', PAID: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Pendiente', PARTIAL: 'Abonada', PAID: 'Saldada' };
const money = (n: string | number) => `RD$ ${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PurchasingPage() {
  const { user, can } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canManage = can?.('purchases.manage') ?? false;

  const [tab, setTab] = useState<'invoices' | 'suppliers'>('invoices');
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  // pago
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');

  // alta proveedor
  const [sName, setSName] = useState('');
  const [sRnc, setSRnc] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sEmail, setSEmail] = useState('');

  const loadDash = useCallback(async () => {
    try { setDash(await apiFetch<Dashboard>('/purchasing/dashboard', tenantId)); } catch { /* ignore */ }
  }, [tenantId]);

  const loadSuppliers = useCallback(async () => {
    try { setSuppliers(await apiFetch<Supplier[]>('/purchasing/suppliers', tenantId)); } catch { /* ignore */ }
  }, [tenantId]);

  const loadInvoices = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (statusFilter !== 'ALL') q.set('status', statusFilter);
      if (search.trim()) q.set('search', search.trim());
      const res = await apiFetch<{ rows: InvoiceRow[] }>(`/purchasing/invoices?${q.toString()}`, tenantId);
      setInvoices(res.rows);
    } catch { /* ignore */ }
  }, [tenantId, statusFilter, search]);

  useEffect(() => { if (tenantId) { loadDash(); loadSuppliers(); } }, [tenantId, loadDash, loadSuppliers]);
  useEffect(() => { if (tenantId) loadInvoices(); }, [tenantId, loadInvoices]);

  const openInvoice = async (id: string) => {
    try { setSelectedInvoice(await apiFetch<InvoiceDetail>(`/purchasing/invoices/${id}`, tenantId)); setPayAmount(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  };

  const createSupplier = async () => {
    if (!sName.trim()) { setError('El nombre es obligatorio'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch('/purchasing/suppliers', tenantId, {
        method: 'POST',
        body: JSON.stringify({ name: sName, rnc: sRnc || null, phone: sPhone || null, email: sEmail || null }),
      });
      setSName(''); setSRnc(''); setSPhone(''); setSEmail(''); setShowSupplierForm(false);
      await loadSuppliers(); await loadDash();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al crear proveedor'); }
    finally { setBusy(false); }
  };

  const pay = async () => {
    if (!selectedInvoice) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setError('Indica un monto válido'); return; }
    setBusy(true); setError('');
    try {
      const updated = await apiFetch<InvoiceDetail>(`/purchasing/invoices/${selectedInvoice.id}/payments`, tenantId, {
        method: 'POST',
        body: JSON.stringify({ amount, method: payMethod }),
      });
      setSelectedInvoice(updated); setPayAmount('');
      await loadInvoices(); await loadDash(); await loadSuppliers();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al registrar el pago'); }
    finally { setBusy(false); }
  };

  const saldar = () => { if (selectedInvoice) setPayAmount(selectedInvoice.balance); };

  return (
    <AdminShell title="Compras" subtitle="Proveedores, facturas y cuentas por pagar"
      actions={canManage && (
        <button onClick={() => { if (suppliers.length) { setShowInvoiceModal(true); } else { setTab('suppliers'); setShowSupplierForm(true); } }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
          + Registrar factura
        </button>
      )}>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Métricas */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricCard label="Total por pagar" value={dash ? money(dash.totalPayable) : '—'} icon="💸" accent="text-rose-600" />
        <MetricCard label="Vencido" value={dash ? money(dash.overduePayable) : '—'} icon="⏰" accent="text-amber-600" />
        <MetricCard label="Proveedores activos" value={dash?.activeSuppliers ?? '—'} icon="🏭" />
      </section>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {(['invoices', 'suppliers'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-500'}`}>
            {t === 'invoices' ? 'Facturas' : 'Proveedores'}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar factura, NCF o proveedor…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="ALL">Todas</option>
              <option value="PENDING">Pendientes</option>
              <option value="PARTIAL">Abonadas</option>
              <option value="PAID">Saldadas</option>
            </select>
          </div>
          <Card className="!p-0 overflow-hidden">
            {invoices.length === 0 ? (
              <p className="py-12 text-center text-slate-400">Sin facturas de compra todavía.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3">Factura</th><th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Fecha</th><th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Saldo</th><th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} onClick={() => openInvoice(inv.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{inv.invoiceNumber}{inv.ncf ? <span className="ml-1 text-xs text-slate-400">· {inv.ncf}</span> : ''}</td>
                      <td className="px-4 py-3 text-slate-600">{inv.supplier.name}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(inv.date).toLocaleDateString('es-DO')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(inv.total)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{money(inv.balance)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[inv.status]}`}>{STATUS_LABEL[inv.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      )}

      {tab === 'suppliers' && (
        <section className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <button onClick={() => setShowSupplierForm((v) => !v)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                {showSupplierForm ? 'Cerrar' : '+ Nuevo proveedor'}
              </button>
            </div>
          )}
          {showSupplierForm && (
            <Card>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Nombre / Razón social" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input value={sRnc} onChange={(e) => setSRnc(e.target.value)} placeholder="RNC (opcional)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input value={sPhone} onChange={(e) => setSPhone(e.target.value)} placeholder="Teléfono" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input value={sEmail} onChange={(e) => setSEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={createSupplier} disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {busy ? 'Guardando…' : 'Crear proveedor'}
                </button>
              </div>
            </Card>
          )}
          <Card className="!p-0 overflow-hidden">
            {suppliers.length === 0 ? (
              <p className="py-12 text-center text-slate-400">Sin proveedores todavía.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">RNC</th>
                    <th className="px-4 py-3">Teléfono</th><th className="px-4 py-3 text-right">Saldo por pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id} onClick={() => setSelectedSupplier(s)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                      <td className="px-4 py-3 text-slate-500">{s.rnc || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{s.phone || '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(s.balance) > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{money(s.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      )}

      {/* Modal registrar factura */}
      {showInvoiceModal && (
        <RegisterInvoiceModal
          tenantId={tenantId}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, rnc: s.rnc }))}
          onClose={() => setShowInvoiceModal(false)}
          onDone={() => { setShowInvoiceModal(false); loadInvoices(); loadDash(); loadSuppliers(); }}
        />
      )}

      {/* Detalle de factura con pago */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedInvoice(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Factura {selectedInvoice.invoiceNumber}</h3>
                <p className="text-xs text-slate-500">{selectedInvoice.supplier.name} · {new Date(selectedInvoice.date).toLocaleDateString('es-DO')}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-lg font-bold tabular-nums">{money(selectedInvoice.total)}</p><p className="text-xs text-slate-500">Total</p></div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-lg font-bold tabular-nums text-rose-600">{money(selectedInvoice.balance)}</p><p className="text-xs text-rose-500">Saldo</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="mt-1 text-sm font-semibold">{STATUS_LABEL[selectedInvoice.status]}</p><p className="text-xs text-slate-500">Estado</p></div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-left text-xs text-slate-500"><th className="px-3 py-2">Línea</th><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cant.</th><th className="px-3 py-2 text-right">Costo</th></tr></thead>
                  <tbody>
                    {selectedInvoice.items.map((it) => (
                      <tr key={it.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-700">{it.rawName}</td>
                        <td className="px-3 py-1.5 text-xs">{it.product ? <span className="text-emerald-600">✓ {it.product.name}</span> : <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{it.quantity}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(it.unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedInvoice.payments.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">Pagos</p>
                  <div className="space-y-1">
                    {selectedInvoice.payments.map((p) => (
                      <div key={p.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                        <span className="text-slate-500">{new Date(p.createdAt).toLocaleDateString('es-DO')} · {p.method}</span>
                        <span className="font-semibold tabular-nums text-emerald-600">{money(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canManage && selectedInvoice.status !== 'PAID' && (
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="mb-2 text-sm font-semibold text-slate-700">Registrar pago</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Monto"
                      className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                      <option value="CASH">Efectivo</option><option value="TRANSFER">Transferencia</option><option value="CARD">Tarjeta</option>
                    </select>
                    <button onClick={saldar} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Saldar todo</button>
                    <button onClick={pay} disabled={busy} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                      {busy ? '…' : 'Pagar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detalle de proveedor */}
      {selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedSupplier(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{selectedSupplier.name}</h3>
                {selectedSupplier.rnc && <p className="text-sm text-slate-500">RNC: {selectedSupplier.rnc}</p>}
              </div>
              <button onClick={() => setSelectedSupplier(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-center">
              <p className="text-2xl font-black tabular-nums text-rose-600">{money(selectedSupplier.balance)}</p>
              <p className="text-xs text-rose-500">Saldo por pagar</p>
            </div>
            <div className="space-y-1 text-sm text-slate-600">
              {selectedSupplier.phone && <p>📞 {selectedSupplier.phone}</p>}
              {selectedSupplier.email && <p>✉️ {selectedSupplier.email}</p>}
              {selectedSupplier.address && <p>📍 {selectedSupplier.address}</p>}
            </div>
            <button onClick={() => { setSelectedSupplier(null); setTab('invoices'); setSearch(selectedSupplier.name); }}
              className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Ver sus facturas
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
