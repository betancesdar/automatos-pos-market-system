'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminShell } from '../../../components/admin/AdminShell';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { LedgerPanel } from '../../../components/admin/LedgerPanel';

type Tab = 'dashboard' | 'reconciliations' | 'purchases' | 'entries' | 'ledger' | 'reports' | 'periods' | 'ecf';

interface DashboardData {
  period: string;
  ventas: { count: number; total: number; itbisCobrado: number };
  compras: { count: number; total: number; itbisAdelantado: number; itbisRetenido: number };
  balance: number;
  aPagar: number;
  aFavor: number;
  cartera?: { porCobrar: number; cobradoMes: number };
  movimientosManuales?: { ingresos: number; gastos: number; ajustes: number };
  alertas: {
    conciliacionesPendientes: number;
    ecfFallidos: number;
    ventasFiscalesSinNcf: number;
  };
  periodoActual: string;
  categoriasGasto: Record<string, string>;
}

interface AccountingEntry {
  id: string;
  date: string;
  type: 'INCOME' | 'EXPENSE' | 'ADJUSTMENT';
  category: string;
  amount: string;
  description: string | null;
}

interface Reconciliation {
  id: string;
  expectedCash: number;
  countedCash: number;
  difference: number;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
  cashSession: {
    openedAt: string;
    closedAt: string | null;
    openingBalance: number;
    user: { name: string; username: string };
  };
}

interface Purchase {
  id: string;
  supplierRnc: string;
  supplierName: string;
  ncf: string;
  expenseCategory: string;
  date: string;
  subtotal: number;
  itbis: number;
  itbisRetenido: number;
  isrRetenido: number;
  total: number;
  notes: string | null;
}

interface Period {
  id: string;
  year: number;
  month: number;
  status: string;
  snapshot: Record<string, unknown> | null;
  closedAt: string | null;
  approvedAt: string | null;
}

interface EcfSubmission {
  id: string;
  status: string;
  attempts: number;
  encf: string | null;
  legalStatus: string | null;
  trackId: string | null;
  lastError: string | null;
  createdAt: string;
  sale: { invoiceNumber: string | null; ncf: string | null; total: number; createdAt: string };
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function money(n: number | undefined | null) {
  return `RD$ ${(n ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadTxt(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const EMPTY_PURCHASE = {
  supplierRnc: '', supplierName: '', ncf: '', expenseCategory: '09',
  date: new Date().toISOString().slice(0, 10),
  subtotal: '', itbis: '', itbisRetenido: '', isrRetenido: '', total: '', notes: '',
};

export default function AccountingPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const now = new Date();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recs, setRecs] = useState<Reconciliation[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [ecfSubs, setEcfSubs] = useState<EcfSubmission[]>([]);
  const [report, setReport] = useState<{ kind: string; data: any } | null>(null);
  const [categories, setCategories] = useState<Record<string, string>>({});

  const [reviewTarget, setReviewTarget] = useState<Reconciliation | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [purchaseForm, setPurchaseForm] = useState({ ...EMPTY_PURCHASE });
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [entryForm, setEntryForm] = useState({ date: '', type: 'EXPENSE' as AccountingEntry['type'], category: '', amount: '', description: '' });

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  // ── loaders ──
  const loadDashboard = useCallback(async () => {
    if (!tenantId) return;
    try {
      const d = await apiFetch<DashboardData>('/accounting/dashboard', tenantId);
      setDashboard(d);
      setCategories(d.categoriasGasto ?? {});
    } catch (err) { fail(err, 'Error cargando dashboard'); }
  }, [tenantId]);

  const loadRecs = useCallback(async () => {
    if (!tenantId) return;
    try {
      setRecs(await apiFetch<Reconciliation[]>('/accounting/reconciliations', tenantId));
    } catch (err) { fail(err, 'Error cargando conciliaciones'); }
  }, [tenantId]);

  const loadPurchases = useCallback(async () => {
    if (!tenantId) return;
    try {
      setPurchases(await apiFetch<Purchase[]>(`/accounting/purchases?year=${year}&month=${month}`, tenantId));
    } catch (err) { fail(err, 'Error cargando compras'); }
  }, [tenantId, year, month]);

  const loadPeriods = useCallback(async () => {
    if (!tenantId) return;
    try {
      setPeriods(await apiFetch<Period[]>('/accounting/periods', tenantId));
    } catch (err) { fail(err, 'Error cargando períodos'); }
  }, [tenantId]);

  const loadEcf = useCallback(async () => {
    if (!tenantId) return;
    try {
      setEcfSubs(await apiFetch<EcfSubmission[]>('/ecf/submissions', tenantId));
    } catch (err) { fail(err, 'Error cargando emisiones e-CF'); }
  }, [tenantId]);

  const loadEntries = useCallback(async () => {
    if (!tenantId) return;
    try {
      setEntries(await apiFetch<AccountingEntry[]>(`/accounting/entries?year=${year}&month=${month}`, tenantId));
    } catch (err) { fail(err, 'Error cargando movimientos'); }
  }, [tenantId, year, month]);

  const saveEntry = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch('/accounting/entries', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          date: entryForm.date, type: entryForm.type, category: entryForm.category,
          amount: parseFloat(entryForm.amount) || 0, description: entryForm.description,
        }),
      });
      setEntryForm({ date: '', type: 'EXPENSE', category: '', amount: '', description: '' });
      loadEntries(); loadDashboard(); flash('Movimiento registrado');
    } catch (err) { fail(err, 'Error registrando movimiento'); }
    finally { setSaving(false); }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try { await apiFetch(`/accounting/entries/${id}`, tenantId, { method: 'DELETE' }); loadEntries(); loadDashboard(); }
    catch (err) { fail(err, 'Error'); }
  };

  useEffect(() => {
    setError('');
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'reconciliations') loadRecs();
    if (tab === 'purchases') { loadPurchases(); loadDashboard(); }
    if (tab === 'entries') { loadEntries(); loadDashboard(); }
    if (tab === 'periods') loadPeriods();
    if (tab === 'ecf') loadEcf();
  }, [tab, loadDashboard, loadRecs, loadPurchases, loadEntries, loadPeriods, loadEcf]);

  // ── actions ──
  const submitReview = async (status: 'APPROVED' | 'OBSERVED') => {
    if (!reviewTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/accounting/reconciliations/${reviewTarget.id}/review`, tenantId, {
        method: 'POST',
        body: JSON.stringify({ status, reviewNotes: reviewNotes || undefined }),
      });
      setReviewTarget(null);
      setReviewNotes('');
      flash(status === 'APPROVED' ? 'Conciliación aprobada' : 'Conciliación observada');
      loadRecs();
    } catch (err) { fail(err, 'Error guardando revisión'); }
    finally { setSaving(false); }
  };

  const savePurchase = async () => {
    setSaving(true);
    setError('');
    try {
      const subtotal = parseFloat(purchaseForm.subtotal) || 0;
      const itbis = parseFloat(purchaseForm.itbis) || 0;
      const total = parseFloat(purchaseForm.total) || subtotal + itbis;
      await apiFetch('/accounting/purchases', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          supplierRnc: purchaseForm.supplierRnc,
          supplierName: purchaseForm.supplierName,
          ncf: purchaseForm.ncf,
          expenseCategory: purchaseForm.expenseCategory,
          date: purchaseForm.date,
          subtotal,
          itbis,
          itbisRetenido: parseFloat(purchaseForm.itbisRetenido) || 0,
          isrRetenido: parseFloat(purchaseForm.isrRetenido) || 0,
          total,
          notes: purchaseForm.notes || undefined,
        }),
      });
      setPurchaseForm({ ...EMPTY_PURCHASE });
      setShowPurchaseForm(false);
      flash('Compra registrada');
      loadPurchases();
    } catch (err) { fail(err, 'Error registrando compra'); }
    finally { setSaving(false); }
  };

  const deletePurchase = async (id: string) => {
    if (!confirm('¿Eliminar esta compra?')) return;
    try {
      await apiFetch(`/accounting/purchases/${id}`, tenantId, { method: 'DELETE' });
      loadPurchases();
    } catch (err) { fail(err, 'Error eliminando compra'); }
  };

  const loadReport = async (kind: '606' | '607' | '608' | 'itbis-summary') => {
    setError('');
    try {
      const data = await apiFetch<any>(
        `/accounting/reports/${kind}?year=${year}&month=${month}`, tenantId,
      );
      setReport({ kind, data });
    } catch (err) { fail(err, `Error generando reporte ${kind}`); }
  };

  const periodAction = async (action: 'close' | 'approve' | 'reopen') => {
    setError('');
    setSaving(true);
    try {
      await apiFetch(`/accounting/periods/${year}/${month}/${action}`, tenantId, { method: 'POST' });
      flash(
        action === 'close' ? 'Período cerrado' :
        action === 'approve' ? 'Período aprobado — listo para presentar en DGII' : 'Período reabierto',
      );
      loadPeriods();
    } catch (err) { fail(err, 'Error en el período'); }
    finally { setSaving(false); }
  };

  const retryEcf = async (id: string) => {
    try {
      await apiFetch(`/ecf/submissions/${id}/retry`, tenantId, { method: 'POST' });
      flash('Reintento encolado — se procesa en menos de 30 segundos');
      loadEcf();
    } catch (err) { fail(err, 'Error reintentando emisión'); }
  };

  // ── UI helpers ──
  const periodSelector = (
    <div className="flex items-center gap-2">
      <select value={month} onChange={(e) => setMonth(parseInt(e.target.value))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
        {MONTH_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
      </select>
      <select value={year} onChange={(e) => setYear(parseInt(e.target.value))}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
        {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );

  const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: '📊 Dashboard' },
    { key: 'reconciliations', label: '💵 Conciliaciones' },
    { key: 'purchases', label: '🧾 Compras/Gastos' },
    { key: 'entries', label: '📒 Movimientos' },
    { key: 'ledger', label: '📘 Libro Contable' },
    { key: 'reports', label: '📑 Reportes DGII' },
    { key: 'periods', label: '🔒 Cierre Mensual' },
    ...(isAdmin ? [{ key: 'ecf' as Tab, label: '⚡ e-CF' }] : []),
  ];

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
      APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      OBSERVED: 'bg-red-50 text-red-700 border-red-200',
      OPEN: 'bg-slate-100 text-slate-600 border-slate-200',
      CLOSED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      SENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      QUEUED: 'bg-slate-100 text-slate-600 border-slate-200',
      PROCESSING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      FAILED: 'bg-red-50 text-red-700 border-red-200',
    };
    return (
      <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${map[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        {status === 'PENDING_REVIEW' ? 'PENDIENTE' : status}
      </span>
    );
  };

  return (
    <AdminShell
      title="Contabilidad"
      subtitle="Conciliaciones, compras, reportes DGII (606/607/608) y cierre mensual"
      actions={periodSelector}
    >
      <div className="space-y-4">

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">✓ {notice}</div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && dashboard && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title={`Ventas (${dashboard.period})`} value={money(dashboard.ventas.total)}
                sub={`${dashboard.ventas.count} ventas`} />
              <StatCard title="ITBIS Cobrado" value={money(dashboard.ventas.itbisCobrado)} sub="en ventas" />
              <StatCard title="Compras del mes" value={money(dashboard.compras.total)}
                sub={`ITBIS adelantado: ${money(dashboard.compras.itbisAdelantado)}`} />
              <StatCard
                title={dashboard.balance >= 0 ? 'ITBIS a Pagar (pre-IT1)' : 'ITBIS a Favor (pre-IT1)'}
                value={money(Math.abs(dashboard.balance))}
                sub="ITBIS cobrado − adelantado"
                accent={dashboard.balance >= 0 ? 'text-red-600' : 'text-emerald-600'}
              />
            </div>
            {(dashboard.cartera || dashboard.movimientosManuales) && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Cartera por cobrar" value={money(dashboard.cartera?.porCobrar ?? 0)}
                  sub="crédito pendiente" accent="text-indigo-600" />
                <StatCard title="Cobrado este mes" value={money(dashboard.cartera?.cobradoMes ?? 0)}
                  sub="abonos de crédito" />
                <StatCard title="Otros ingresos" value={money(dashboard.movimientosManuales?.ingresos ?? 0)}
                  sub="movimientos manuales" />
                <StatCard title="Otros gastos" value={money(dashboard.movimientosManuales?.gastos ?? 0)}
                  sub="movimientos manuales" accent="text-red-600" />
              </div>
            )}
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">Checklist del contable</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Alert count={dashboard.alertas.conciliacionesPendientes}
                  ok="Todas las cajas conciliadas" bad="conciliación(es) pendiente(s)"
                  onClick={() => setTab('reconciliations')} />
                <Alert count={dashboard.alertas.ventasFiscalesSinNcf}
                  ok="Todas las ventas fiscales con NCF" bad="venta(s) fiscal(es) SIN NCF este mes"
                  onClick={() => setTab('reports')} />
                <Alert count={dashboard.alertas.ecfFallidos}
                  ok="Sin emisiones e-CF fallidas" bad="emisión(es) e-CF fallida(s)"
                  onClick={() => isAdmin && setTab('ecf')} />
              </div>
            </div>
          </div>
        )}

        {/* ── CONCILIACIONES ── */}
        {tab === 'reconciliations' && (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Cajero</th>
                  <th className="px-4 py-3 text-right">Esperado</th>
                  <th className="px-4 py-3 text-right">Contado</th>
                  <th className="px-4 py-3 text-right">Diferencia</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Nota</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {recs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No hay cierres de caja registrados</td></tr>
                )}
                {recs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">{new Date(r.createdAt).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="px-4 py-3 font-medium">{r.cashSession.user.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(r.expectedCash)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(r.countedCash)}</td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${
                      r.difference === 0 ? 'text-emerald-600' : r.difference > 0 ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {r.difference === 0 ? '✓ 0.00' : money(r.difference)}
                    </td>
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-500">{r.reviewNotes}</td>
                    <td className="px-4 py-3">
                      {r.status === 'PENDING_REVIEW' && (
                        <button onClick={() => { setReviewTarget(r); setReviewNotes(''); }}
                          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500">
                          Revisar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── COMPRAS ── */}
        {tab === 'purchases' && (
          <div className="space-y-4">
            <div className="flex justify-between">
              <p className="text-sm text-slate-500">
                Compras y gastos con NCF de proveedor — alimentan el Formato 606
              </p>
              <button onClick={() => setShowPurchaseForm((v) => !v)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
                {showPurchaseForm ? 'Cerrar' : '+ Registrar Compra'}
              </button>
            </div>

            {showPurchaseForm && (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="RNC Proveedor *">
                    <input value={purchaseForm.supplierRnc}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, supplierRnc: e.target.value })}
                      placeholder="9 u 11 dígitos" className="input" />
                  </Field>
                  <Field label="Nombre Proveedor *">
                    <input value={purchaseForm.supplierName}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, supplierName: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="NCF *">
                    <input value={purchaseForm.ncf}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, ncf: e.target.value })}
                      placeholder="B0100000001" className="input" />
                  </Field>
                  <Field label="Categoría de Gasto DGII *">
                    <select value={purchaseForm.expenseCategory}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, expenseCategory: e.target.value })}
                      className="input">
                      {Object.entries(categories).map(([code, name]) => (
                        <option key={code} value={code}>{code} — {name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Fecha *">
                    <input type="date" value={purchaseForm.date}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, date: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="Subtotal (sin ITBIS) *">
                    <input type="number" step="0.01" value={purchaseForm.subtotal}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, subtotal: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="ITBIS">
                    <input type="number" step="0.01" value={purchaseForm.itbis}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, itbis: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="ITBIS Retenido">
                    <input type="number" step="0.01" value={purchaseForm.itbisRetenido}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, itbisRetenido: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="ISR Retenido">
                    <input type="number" step="0.01" value={purchaseForm.isrRetenido}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, isrRetenido: e.target.value })}
                      className="input" />
                  </Field>
                  <Field label="Total *">
                    <input type="number" step="0.01" value={purchaseForm.total}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, total: e.target.value })}
                      placeholder="subtotal + ITBIS" className="input" />
                  </Field>
                  <Field label="Nota">
                    <input value={purchaseForm.notes}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                      className="input" />
                  </Field>
                </div>
                <button onClick={savePurchase} disabled={saving}
                  className="mt-4 rounded-xl bg-indigo-600 px-6 py-2.5 font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {saving ? 'Guardando…' : 'Guardar Compra'}
                </button>
              </div>
            )}

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">NCF</th>
                    <th className="px-4 py-3">Cat.</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                    <th className="px-4 py-3 text-right">ITBIS</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {purchases.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      Sin compras registradas en {MONTH_NAMES[month - 1]} {year}
                    </td></tr>
                  )}
                  {purchases.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">{new Date(p.date).toLocaleDateString('es-DO')}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.supplierName}</p>
                        <p className="text-xs text-slate-400">{p.supplierRnc}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{p.ncf}</td>
                      <td className="px-4 py-3">{p.expenseCategory}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(p.subtotal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(p.itbis)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{money(p.total)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deletePurchase(p.id)} className="text-red-400 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── MOVIMIENTOS / ASIENTOS MANUALES ── */}
        {tab === 'entries' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Ingresos, gastos o ajustes que no vienen de ventas ni compras (ej. pago de luz sin NCF, ajuste de caja).
            </p>
            {isAdmin && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="grid gap-3 md:grid-cols-5">
                  <input type="date" value={entryForm.date} onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select value={entryForm.type} onChange={(e) => setEntryForm({ ...entryForm, type: e.target.value as AccountingEntry['type'] })}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="EXPENSE">Gasto</option><option value="INCOME">Ingreso</option><option value="ADJUSTMENT">Ajuste</option>
                  </select>
                  <input value={entryForm.category} onChange={(e) => setEntryForm({ ...entryForm, category: e.target.value })}
                    placeholder="Categoría (ej. Luz)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <input type="number" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })}
                    placeholder="Monto" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <button onClick={saveEntry} disabled={saving || !entryForm.date || !entryForm.category || !entryForm.amount}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Registrar</button>
                </div>
                <input value={entryForm.description} onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
                  placeholder="Descripción / soporte (opcional)" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold">Tipo</th>
                  <th className="px-4 py-3 text-left font-semibold">Categoría</th>
                  <th className="px-4 py-3 text-left font-semibold">Descripción</th>
                  <th className="px-4 py-3 text-right font-semibold">Monto</th>
                  <th className="px-4 py-3" />
                </tr></thead>
                <tbody>
                  {entries.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Sin movimientos este mes.</td></tr>}
                  {entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-4 py-2.5">{new Date(e.date).toLocaleDateString('es-DO')}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${e.type === 'INCOME' ? 'bg-emerald-50 text-emerald-700' : e.type === 'EXPENSE' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                          {e.type === 'INCOME' ? 'Ingreso' : e.type === 'EXPENSE' ? 'Gasto' : 'Ajuste'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{e.category}</td>
                      <td className="px-4 py-2.5 text-slate-500">{e.description ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{money(Number(e.amount))}</td>
                      <td className="px-4 py-2.5 text-right">{isAdmin && <button onClick={() => deleteEntry(e.id)} className="text-red-500 hover:text-red-700">✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REPORTES DGII ── */}
        {tab === 'reports' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([
                ['606', '606 — Compras'],
                ['607', '607 — Ventas'],
                ['608', '608 — NCF Anulados'],
                ['itbis-summary', 'Resumen ITBIS (IT-1)'],
              ] as const).map(([kind, label]) => (
                <button key={kind} onClick={() => loadReport(kind)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold ${
                    report?.kind === kind
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {report && report.kind !== 'itbis-summary' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-900">
                      Formato {report.kind} · {MONTH_NAMES[month - 1]} {year}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {report.data.count} registro(s)
                      {report.kind === '607' && report.data.salesWithoutNcf > 0 && (
                        <span className="ml-2 font-bold text-amber-600">
                          ⚠️ {report.data.salesWithoutNcf} venta(s) sin NCF no incluidas
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => downloadTxt(`DGII_F_${report.kind}_${report.data.period}.txt`, report.data.txt)}
                    disabled={!report.data.txt}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                    ⬇ Descargar TXT
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-left uppercase text-slate-500">
                      <tr>
                        {report.data.rows[0] &&
                          Object.keys(report.data.rows[0]).map((k) => (
                            <th key={k} className="px-2 py-2">{k}</th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.length === 0 && (
                        <tr><td className="px-2 py-8 text-center text-slate-400">Sin registros en el período</td></tr>
                      )}
                      {report.data.rows.map((row: Record<string, unknown>, i: number) => (
                        <tr key={i} className="border-t border-slate-100">
                          {Object.values(row).map((v, j) => (
                            <td key={j} className="px-2 py-1.5 tabular-nums">{String(v ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {report && report.kind === 'itbis-summary' && (
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard title="ITBIS Cobrado (ventas)" value={money(report.data.ventas.itbisCobrado)}
                  sub={`${report.data.ventas.count} ventas · ${money(report.data.ventas.total)}`} />
                <StatCard title="ITBIS Adelantado (compras)" value={money(report.data.compras.itbisAdelantado)}
                  sub={`${report.data.compras.count} compras · ${money(report.data.compras.total)}`} />
                <StatCard
                  title={report.data.balance >= 0 ? 'A PAGAR en IT-1' : 'A FAVOR en IT-1'}
                  value={money(Math.abs(report.data.balance))}
                  sub="El contable verifica y presenta"
                  accent={report.data.balance >= 0 ? 'text-red-600' : 'text-emerald-600'}
                />
              </div>
            )}
          </div>
        )}

        {/* ── CIERRE MENSUAL ── */}
        {tab === 'periods' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-bold text-slate-900">
                Período seleccionado: {MONTH_NAMES[month - 1]} {year}
              </h3>
              <p className="mb-4 text-sm text-slate-500">
                Flujo: el sistema congela los totales al <strong>cerrar</strong> → el contable <strong>verifica y aprueba</strong> → descarga los TXT y presenta en DGII.
              </p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => periodAction('close')} disabled={saving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  🔒 Cerrar período
                </button>
                <button onClick={() => periodAction('approve')} disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                  ✓ Aprobar (contable)
                </button>
                {isAdmin && (
                  <button onClick={() => periodAction('reopen')} disabled={saving}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                    Reabrir
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Período</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Ventas</th>
                    <th className="px-4 py-3 text-right">ITBIS Balance</th>
                    <th className="px-4 py-3 text-right">Dif. Cajas</th>
                    <th className="px-4 py-3">Cerrado</th>
                    <th className="px-4 py-3">Aprobado</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Aún no hay períodos cerrados</td></tr>
                  )}
                  {periods.map((p) => {
                    const snap = (p.snapshot ?? {}) as Record<string, any>;
                    return (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-bold">{MONTH_NAMES[p.month - 1]} {p.year}</td>
                        <td className="px-4 py-3">{statusBadge(p.status)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(snap.ventas?.total)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(snap.itbisBalance)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{money(snap.diferenciaCajas)}</td>
                        <td className="px-4 py-3 text-xs">{p.closedAt ? new Date(p.closedAt).toLocaleDateString('es-DO') : '—'}</td>
                        <td className="px-4 py-3 text-xs">{p.approvedAt ? new Date(p.approvedAt).toLocaleDateString('es-DO') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── e-CF ── */}
        {tab === 'ecf' && isAdmin && (
          <EcfSection
            tenantId={tenantId}
            subs={ecfSubs}
            onRetry={retryEcf}
            onReload={loadEcf}
            statusBadge={statusBadge}
            flash={flash}
            fail={fail}
          />
        )}

        {tab === 'ledger' && (
          <LedgerPanel tenantId={tenantId} canManage={isAdmin} />
        )}
      </div>

      {/* Review modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-900">Revisar Conciliación</h3>
              <p className="text-sm text-slate-500">
                {reviewTarget.cashSession.user.name} · {new Date(reviewTarget.createdAt).toLocaleString('es-DO')}
              </p>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center text-sm">
                <div><p className="text-xs text-slate-500">Esperado</p><p className="font-bold tabular-nums">{money(reviewTarget.expectedCash)}</p></div>
                <div><p className="text-xs text-slate-500">Contado</p><p className="font-bold tabular-nums">{money(reviewTarget.countedCash)}</p></div>
                <div>
                  <p className="text-xs text-slate-500">Diferencia</p>
                  <p className={`font-bold tabular-nums ${reviewTarget.difference === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {money(reviewTarget.difference)}
                  </p>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nota de revisión</label>
                <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2}
                  placeholder="Ej. faltante justificado por cambio entregado de más"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setReviewTarget(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 font-medium">
                  Cancelar
                </button>
                <button onClick={() => submitReview('OBSERVED')} disabled={saving}
                  className="flex-1 rounded-xl border border-red-200 bg-red-50 py-2.5 font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  Observar
                </button>
                <button onClick={() => submitReview('APPROVED')} disabled={saving}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                  Aprobar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function StatCard({ title, value, sub, accent }: { title: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${accent ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function Alert({ count, ok, bad, onClick }: { count: number; ok: string; bad: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={count === 0}
      className={`rounded-xl border p-3 text-left text-sm ${
        count === 0
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
      }`}>
      {count === 0 ? `✓ ${ok}` : `⚠️ ${count} ${bad}`}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
      {children}
      <style jsx>{`
        div :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        div :global(.input:focus) {
          border-color: rgb(129 140 248);
        }
      `}</style>
    </div>
  );
}

// ── e-CF tab: config + submissions ──
function EcfSection({
  tenantId, subs, onRetry, onReload, statusBadge, flash, fail,
}: {
  tenantId: string;
  subs: EcfSubmission[];
  onRetry: (id: string) => void;
  onReload: () => void;
  statusBadge: (s: string) => React.ReactNode;
  flash: (m: string) => void;
  fail: (e: unknown, f: string) => void;
}) {
  const [config, setConfig] = useState<{ enabled: boolean; pronesoftBusinessId: string | null; pronesoftRnc: string | null; platformEnabled: boolean } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ enabled: boolean; pronesoftBusinessId: string | null; pronesoftRnc: string | null; platformEnabled: boolean }>('/ecf/config', tenantId)
      .then((c) => {
        setConfig(c);
        setEnabled(c.enabled);
      })
      .catch(() => {});
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/ecf/config', tenantId, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      flash('Configuración e-CF guardada');
      onReload();
    } catch (err) { fail(err, 'Error guardando configuración e-CF'); }
    finally { setSaving(false); }
  };

  const linked = Boolean(config?.pronesoftBusinessId);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 font-bold text-slate-900">Facturación Electrónica (Pronesoft)</h3>
        <p className="mb-4 text-xs text-slate-500">
          Facturación electrónica <b>real</b> ante la DGII. Las credenciales y el vínculo con tu empresa las
          administra el proveedor del sistema; aquí solo activas o desactivas la emisión de e-CF.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Emisión de e-CF</label>
            <button onClick={() => setEnabled((v) => !v)}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-bold ${
                enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}>
              {enabled ? '✓ Habilitado' : 'Deshabilitado'}
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Vínculo con tu empresa</label>
            <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${linked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
              {linked ? '✓ Empresa vinculada' : 'Pendiente de vincular'}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Plataforma</label>
            <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${config?.platformEnabled ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {config?.platformEnabled ? '✓ Activa' : 'No configurada'}
            </div>
          </div>
        </div>
        {!linked && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Para emitir e-CF, el proveedor del sistema debe vincular tu empresa y registrar tus secuencias de e-NCF.
          </p>
        )}
        <button onClick={save} disabled={saving}
          className="mt-4 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Factura</th>
              <th className="px-4 py-3">NCF</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">e-NCF</th>
              <th className="px-4 py-3">DGII</th>
              <th className="px-4 py-3">Intentos</th>
              <th className="px-4 py-3">Último error</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Sin emisiones e-CF aún</td></tr>
            )}
            {subs.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs">{s.sale.invoiceNumber}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.sale.ncf}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(s.sale.total)}</td>
                <td className="px-4 py-3">{statusBadge(s.status)}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.encf ?? '—'}</td>
                <td className="px-4 py-3">
                  {s.legalStatus ? (
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      s.legalStatus === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700'
                      : s.legalStatus === 'REJECTED' ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'}`}>{s.legalStatus}</span>
                  ) : s.status === 'SENT' ? <span className="text-xs text-slate-400">procesando…</span> : '—'}
                </td>
                <td className="px-4 py-3 text-center">{s.attempts}</td>
                <td className="max-w-[200px] truncate px-4 py-3 text-xs text-red-500">{s.lastError}</td>
                <td className="px-4 py-3">
                  {s.status === 'FAILED' && (
                    <button onClick={() => onRetry(s.id)}
                      className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500">
                      Reintentar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
