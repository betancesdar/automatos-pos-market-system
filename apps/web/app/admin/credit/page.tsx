'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { AdminShell } from '../../../components/admin/AdminShell';

interface Installment { id: string; number: number; dueDate: string; amount: string; paidAmount: string; status: string; }
interface Payment { id: string; amount: string; method: string; isDownPayment: boolean; note: string | null; createdAt: string; }
interface PromissoryNote { number: string; amount: string; amountInWords: string; legalText: string; debtorSnapshot: Record<string, string | null>; }
interface CreditSale {
  id: string; principal: string; downPayment: string; financedAmount: string; balance: string;
  installmentsCount: number; frequency: string; firstDueDate: string; lateFeePercent: string; status: string;
  customer: { id: string; name: string; phone: string | null; docNumber?: string | null; docType?: string } | null;
  sale?: { invoiceNumber: string | null; ncf: string | null; createdAt: string };
  installments: Installment[]; payments: Payment[]; promissoryNote: PromissoryNote | null;
}
interface CustomerOpt { id: string; name: string }
interface ProductOpt { id: string; name: string; price: number }

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700', OVERDUE: 'bg-red-100 text-red-700',
  PAID: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-slate-100 text-slate-600',
};
const STATUS_LABEL: Record<string, string> = { OPEN: 'Al día', OVERDUE: 'En mora', PAID: 'Saldado', CANCELLED: 'Cancelado' };
const INST_COLOR: Record<string, string> = {
  PENDING: 'text-slate-500', PARTIAL: 'text-amber-600', PAID: 'text-emerald-600', OVERDUE: 'text-red-600',
};

export default function CreditPage() {
  const { user, can } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [dash, setDash] = useState<{ porCobrar: number; vencido: number; cuentas: Record<string, number> } | null>(null);
  const [list, setList] = useState<CreditSale[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<CreditSale | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // nueva venta a crédito
  const [showForm, setShowForm] = useState(false);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [fCustomer, setFCustomer] = useState('');
  const [items, setItems] = useState<{ productId: string; name: string; quantity: number; unitPrice: number }[]>([]);
  const [pSearch, setPSearch] = useState('');
  const [down, setDown] = useState('0');
  const [count, setCount] = useState('3');
  const [freq, setFreq] = useState('MONTHLY');
  const [intervalDays, setIntervalDays] = useState('10');
  const [firstDue, setFirstDue] = useState('');
  const [lateFee, setLateFee] = useState('0');

  // abono
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const [d, l] = await Promise.all([
        apiFetch<typeof dash>('/credit/dashboard', tenantId),
        apiFetch<{ rows: CreditSale[]; total: number; pages: number }>(`/credit?${params.toString()}`, tenantId),
      ]);
      setDash(d); setList(l.rows); setTotalCount(l.total); setPages(l.pages);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }, [tenantId, statusFilter, search, page]);

  // Reiniciar a la página 1 al cambiar filtro o búsqueda.
  useEffect(() => { setPage(1); }, [statusFilter, search]);

  // Debounce de la búsqueda para no golpear en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => { loadList(); }, 300);
    return () => clearTimeout(t);
  }, [loadList]);

  const openForm = async () => {
    setShowForm(true);
    try {
      const [cs, ps] = await Promise.all([
        apiFetch<CustomerOpt[]>('/customers?onlyActive=true', tenantId),
        apiFetch<ProductOpt[]>('/catalog/products', tenantId),
      ]);
      setCustomers(cs); setProducts(ps);
    } catch { /* ignore */ }
  };

  const openDetail = async (id: string) => {
    try { setSelected(await apiFetch<CreditSale>(`/credit/${id}`, tenantId)); setPayAmount(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  };

  const addProduct = (p: ProductOpt) => {
    setItems((prev) => {
      const ex = prev.find((i) => i.productId === p.id);
      if (ex) return prev.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { productId: p.id, name: p.name, quantity: 1, unitPrice: p.price }];
    });
    setPSearch('');
  };
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const createCredit = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch('/credit/checkout', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          customerId: fCustomer,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
          downPayment: parseFloat(down) || 0,
          installmentsCount: parseInt(count, 10) || 1,
          frequency: freq,
          intervalDays: freq === 'CUSTOM' ? parseInt(intervalDays, 10) || 1 : undefined,
          firstDueDate: firstDue,
          lateFeePercent: parseFloat(lateFee) || 0,
        }),
      });
      setShowForm(false); setItems([]); setFCustomer(''); setDown('0'); setFirstDue('');
      loadList();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error creando venta a crédito'); }
    finally { setBusy(false); }
  };

  const registerPayment = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const updated = await apiFetch<CreditSale>(`/credit/${selected.id}/payments`, tenantId, {
        method: 'POST', body: JSON.stringify({ amount: parseFloat(payAmount) || 0, method: payMethod }),
      });
      setSelected(updated); setPayAmount(''); loadList();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error registrando abono'); }
    finally { setBusy(false); }
  };

  const printNote = (c: CreditSale) => {
    if (!c.promissoryNote) return;
    const n = c.promissoryNote;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pagaré ${n.number}</title>
      <style>body{font-family:'Times New Roman',serif;padding:48px;color:#1a1a1a;line-height:1.8;max-width:720px;margin:auto}
      h1{text-align:center;font-size:20px;letter-spacing:2px}.n{text-align:right;color:#555}.amt{font-size:18px;font-weight:bold;text-align:center;margin:24px 0}
      .sign{margin-top:72px;display:flex;justify-content:space-between}.sign div{border-top:1px solid #000;width:40%;text-align:center;padding-top:6px}</style></head><body>
      <h1>PAGARÉ NOTARIAL</h1>
      <p class="n">No. ${n.number}</p>
      <p class="amt">RD$ ${Number(n.amount).toFixed(2)}<br><small>(${n.amountInWords})</small></p>
      <p>${n.legalText}</p>
      <div class="sign"><div>Deudor<br>${n.debtorSnapshot.name ?? ''}</div><div>Acreedor</div></div>
      <script>window.print()</script></body></html>`);
    w.document.close();
  };

  const filteredProducts = pSearch.trim() ? products.filter((p) => p.name.toLowerCase().includes(pSearch.toLowerCase())).slice(0, 6) : [];

  return (
    <AdminShell title="Crédito / Cuentas por cobrar" subtitle="Ventas a crédito, cuotas, abonos y pagarés notariales">
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Total por cobrar</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">RD$ {(dash?.porCobrar ?? 0).toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-red-500">En mora</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-red-700">RD$ {(dash?.vencido ?? 0).toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Cuentas activas</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{(dash?.cuentas?.OPEN ?? 0) + (dash?.cuentas?.OVERDUE ?? 0)}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {['ALL', 'OPEN', 'OVERDUE', 'PAID'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${statusFilter === s ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {s === 'ALL' ? 'Todas' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, documento o teléfono…"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {can('credit.sell') && (
          <button onClick={openForm} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            + Nueva venta a crédito
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-xs text-amber-700">Requiere una caja abierta a tu nombre (el inicial entra a caja).</p>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Cliente</label>
              <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— Selecciona —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700"># Cuotas</label>
              <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Frecuencia</label>
              <select value={freq} onChange={(e) => setFreq(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="DAILY">Diaria</option>
                <option value="WEEKLY">Semanal</option>
                <option value="BIWEEKLY">Quincenal</option>
                <option value="MONTHLY">Mensual</option>
                <option value="CUSTOM">Cada X días…</option>
              </select>
            </div>
            {freq === 'CUSTOM' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Cada cuántos días</label>
                <input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Inicial (RD$)</label>
              <input type="number" value={down} onChange={(e) => setDown(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">1ra cuota</label>
              <input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Mora (%)</label>
              <input type="number" value={lateFee} onChange={(e) => setLateFee(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="relative mt-4">
            <input value={pSearch} onChange={(e) => setPSearch(e.target.value)} placeholder="Buscar producto…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {filteredProducts.map((p) => (
                  <button key={p.id} onClick={() => addProduct(p)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50">
                    <span>{p.name}</span><span className="text-slate-500">RD$ {p.price.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {items.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {items.map((i) => (
                  <tr key={i.productId} className="border-t border-slate-100">
                    <td className="py-2">{i.name}</td>
                    <td className="text-right"><input type="number" min={1} value={i.quantity} onChange={(e) => setItems((prev) => prev.map((x) => x.productId === i.productId ? { ...x, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))} className="w-16 rounded border border-slate-300 px-2 py-1 text-right" /></td>
                    <td className="text-right tabular-nums">RD$ {(i.quantity * i.unitPrice).toFixed(2)}</td>
                    <td className="pl-2 text-right"><button onClick={() => setItems((prev) => prev.filter((x) => x.productId !== i.productId))} className="text-red-500">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-right"><span className="text-sm text-slate-500">Total: </span><span className="text-xl font-bold tabular-nums">RD$ {total.toFixed(2)}</span>
              <span className="ml-3 text-sm text-slate-500">Financiado: </span><span className="font-bold tabular-nums text-indigo-700">RD$ {Math.max(0, total - (parseFloat(down) || 0)).toFixed(2)}</span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
              <button onClick={createCredit} disabled={busy || !fCustomer || items.length === 0 || !firstDue}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Procesando…' : 'Crear venta a crédito'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th className="px-4 py-3 text-left font-semibold">Cliente</th>
              <th className="px-4 py-3 text-left font-semibold">Estado</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
              <th className="px-4 py-3 text-right font-semibold"></th>
            </tr></thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Sin cuentas por cobrar.</td></tr>}
              {list.map((c) => (
                <tr key={c.id} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected?.id === c.id ? 'bg-indigo-50' : ''}`} onClick={() => openDetail(c.id)}>
                  <td className="px-4 py-3 font-medium text-slate-900">{c.customer?.name}</td>
                  <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">RD$ {Number(c.balance).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-indigo-600">Ver →</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm">
              <span className="text-slate-500">{totalCount} cuenta(s) · pág. {page} de {pages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-600 disabled:opacity-40">← Anterior</button>
                <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-600 disabled:opacity-40">Siguiente →</button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {!selected && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">Selecciona una cuenta para ver cuotas y registrar abonos.</div>}
          {selected && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="font-bold text-slate-900">{selected.customer?.name}</p>
                  <p className="text-xs text-slate-500">{selected.sale?.invoiceNumber} · Balance RD$ {Number(selected.balance).toFixed(2)}</p>
                </div>
                <button onClick={() => printNote(selected)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">🖨 Pagaré</button>
              </div>

              <table className="mb-3 w-full text-xs">
                <thead><tr className="text-left text-slate-400"><th className="py-1">Cuota</th><th>Vence</th><th className="text-right">Monto</th><th className="text-right">Pagado</th></tr></thead>
                <tbody>
                  {selected.installments.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="py-1.5 font-semibold">#{i.number}</td>
                      <td className={INST_COLOR[i.status]}>{new Date(i.dueDate).toLocaleDateString('es-DO')}</td>
                      <td className="text-right tabular-nums">{Number(i.amount).toFixed(2)}</td>
                      <td className={`text-right tabular-nums ${INST_COLOR[i.status]}`}>{Number(i.paidAmount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {selected.status !== 'PAID' && selected.status !== 'CANCELLED' && can('credit.payment') && (
                <div className="mb-3 flex gap-2">
                  <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Monto abono" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                    <option value="CASH">Efectivo</option><option value="TRANSFER">Transfer.</option><option value="CARD">Tarjeta</option>
                  </select>
                  <button onClick={registerPayment} disabled={busy || !payAmount} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Abonar</button>
                </div>
              )}

              {selected.payments.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  <p className="mb-1 text-xs font-bold uppercase text-slate-400">Abonos</p>
                  {selected.payments.map((p) => (
                    <div key={p.id} className="flex justify-between border-t border-slate-100 py-1 text-xs">
                      <span>{new Date(p.createdAt).toLocaleDateString('es-DO')} · {p.method}{p.isDownPayment ? ' (inicial)' : ''}</span>
                      <span className="font-semibold tabular-nums text-emerald-600">RD$ {Number(p.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
