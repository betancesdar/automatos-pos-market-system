'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { AdminShell } from '../../../components/admin/AdminShell';

interface QuoteItem { id?: string; productId: string; productName: string; quantity: number; unitPrice: string | number; }
interface Quote {
  id: string; number: number; status: string; validUntil: string | null;
  subtotal: string; itbis: string; total: string; notes: string | null;
  clientNameSnapshot: string | null;
  customer: { id: string; name: string; docType: string; docNumber: string | null; phone: string | null } | null;
  items: QuoteItem[]; createdAt: string;
}
interface CustomerOpt { id: string; name: string }
interface ProductOpt { id: string; name: string; price: number; stock: number }

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador', SENT: 'Enviada', ACCEPTED: 'Aceptada',
  CONVERTED: 'Convertida', EXPIRED: 'Vencida', CANCELLED: 'Cancelada',
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600', SENT: 'bg-blue-100 text-blue-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700', CONVERTED: 'bg-violet-100 text-violet-700',
  EXPIRED: 'bg-amber-100 text-amber-700', CANCELLED: 'bg-red-100 text-red-700',
};

export default function QuotesPage() {
  const { user, can } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // form
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ productId: string; name: string; quantity: number; unitPrice: number }[]>([]);
  const [productSearch, setProductSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const q = statusFilter === 'ALL' ? '' : `?status=${statusFilter}`;
      const [qs, cs, ps] = await Promise.all([
        apiFetch<Quote[]>(`/quotes${q}`, tenantId),
        apiFetch<CustomerOpt[]>('/customers?onlyActive=true', tenantId),
        apiFetch<ProductOpt[]>('/catalog/products', tenantId),
      ]);
      setQuotes(qs); setCustomers(cs); setProducts(ps);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }, [tenantId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setCustomerId(''); setClientName(''); setValidUntil(''); setNotes(''); setItems([]); setProductSearch('');
  };

  const addProduct = (p: ProductOpt) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id);
      if (existing) return prev.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { productId: p.id, name: p.name, quantity: 1, unitPrice: p.price }];
    });
    setProductSearch('');
  };

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const createQuote = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch('/quotes', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          customerId: customerId || null,
          clientName: clientName || null,
          validUntil: validUntil || null,
          notes: notes || null,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
        }),
      });
      resetForm(); setShowForm(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error creando cotización'); }
    finally { setBusy(false); }
  };

  const convert = async (q: Quote) => {
    if (!confirm(`¿Convertir la cotización #${q.number} en un pedido de cobro?`)) return;
    setBusy(true); setError('');
    try {
      const res = await apiFetch<{ order: { dailyCode: number } }>(`/quotes/${q.id}/convert`, tenantId, { method: 'POST' });
      alert(`Convertida. Pedido #${String(res.order.dailyCode).padStart(3, '0')} — cóbralo en caja.`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al convertir'); }
    finally { setBusy(false); }
  };

  const setStatus = async (q: Quote, status: string) => {
    try { await apiFetch(`/quotes/${q.id}/status`, tenantId, { method: 'PATCH', body: JSON.stringify({ status }) }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  const print = (q: Quote) => {
    const rows = q.items.map((i) =>
      `<tr><td>${i.productName}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${Number(i.unitPrice).toFixed(2)}</td><td style="text-align:right">${(i.quantity * Number(i.unitPrice)).toFixed(2)}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Cotización #${q.number}</title>
      <style>body{font-family:system-ui,sans-serif;padding:32px;color:#1e293b}h1{margin:0}
      table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:14px}
      th{text-align:left;color:#64748b;font-size:12px;text-transform:uppercase}
      .tot{margin-top:16px;text-align:right;font-size:14px}.tot b{font-size:18px}</style></head><body>
      <h1>Cotización #${String(q.number).padStart(4, '0')}</h1>
      <p style="color:#64748b">Fecha: ${new Date(q.createdAt).toLocaleDateString('es-DO')}${q.validUntil ? ` · Válida hasta: ${new Date(q.validUntil).toLocaleDateString('es-DO')}` : ''}</p>
      <p><b>Cliente:</b> ${q.customer?.name ?? q.clientNameSnapshot ?? 'Consumidor final'}${q.customer?.docNumber ? ` · ${q.customer.docType} ${q.customer.docNumber}` : ''}</p>
      <table><thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">Subtotal: RD$ ${Number(q.subtotal).toFixed(2)}<br>ITBIS: RD$ ${Number(q.itbis).toFixed(2)}<br><b>Total: RD$ ${Number(q.total).toFixed(2)}</b></div>
      ${q.notes ? `<p style="margin-top:16px;color:#64748b">${q.notes}</p>` : ''}
      <p style="margin-top:32px;color:#94a3b8;font-size:12px">Esta cotización no es una factura fiscal.</p>
      <script>window.print()</script></body></html>`);
    w.document.close();
  };

  const filteredProducts = productSearch.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(productSearch.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <AdminShell title="Cotizaciones" subtitle="Crea cotizaciones, imprímelas y conviértelas en pedido de cobro">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'CONVERTED', 'EXPIRED', 'CANCELLED'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${statusFilter === s ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {s === 'ALL' ? 'Todas' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {can('quotes.manage') && (
          <button onClick={() => { resetForm(); setShowForm((v) => !v); }}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
            {showForm ? 'Cerrar' : '+ Nueva cotización'}
          </button>
        )}
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {showForm && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Cliente</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">— Sin registrar —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {!customerId && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nombre (si no está registrado)</label>
                <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Válida hasta</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="relative mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">Agregar producto</label>
            <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Buscar producto por nombre…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {filteredProducts.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {filteredProducts.map((p) => (
                  <button key={p.id} onClick={() => addProduct(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50">
                    <span>{p.name}</span>
                    <span className="text-slate-500">RD$ {p.price.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2">Producto</th><th className="text-right">Cant.</th><th className="text-right">Precio</th><th className="text-right">Importe</th><th /></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.productId} className="border-t border-slate-100">
                    <td className="py-2">{i.name}</td>
                    <td className="text-right">
                      <input type="number" min={1} value={i.quantity}
                        onChange={(e) => setItems((prev) => prev.map((x) => x.productId === i.productId ? { ...x, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))}
                        className="w-16 rounded border border-slate-300 px-2 py-1 text-right" />
                    </td>
                    <td className="text-right">
                      <input type="number" step="0.01" value={i.unitPrice}
                        onChange={(e) => setItems((prev) => prev.map((x) => x.productId === i.productId ? { ...x, unitPrice: parseFloat(e.target.value) || 0 } : x))}
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right" />
                    </td>
                    <td className="text-right tabular-nums">{(i.quantity * i.unitPrice).toFixed(2)}</td>
                    <td className="pl-2 text-right"><button onClick={() => setItems((prev) => prev.filter((x) => x.productId !== i.productId))} className="text-red-500">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 flex items-center justify-between">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)"
              className="mr-4 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="text-right">
              <p className="text-sm text-slate-500">Total (ITBIS incl.)</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900">RD$ {total.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-3">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
            <button onClick={createQuote} disabled={busy || items.length === 0}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Guardando…' : 'Crear cotización'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th className="px-6 py-3 text-left font-semibold">#</th>
              <th className="px-4 py-3 text-left font-semibold">Cliente</th>
              <th className="px-4 py-3 text-left font-semibold">Estado</th>
              <th className="px-4 py-3 text-left font-semibold">Válida hasta</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-6 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">Sin cotizaciones.</td></tr>}
            {quotes.map((q) => (
              <tr key={q.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-6 py-3 font-bold text-indigo-700">#{String(q.number).padStart(4, '0')}</td>
                <td className="px-4 py-3 text-slate-700">{q.customer?.name ?? q.clientNameSnapshot ?? 'Consumidor final'}</td>
                <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[q.status]}`}>{STATUS_LABEL[q.status]}</span></td>
                <td className="px-4 py-3 text-slate-500">{q.validUntil ? new Date(q.validUntil).toLocaleDateString('es-DO') : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">RD$ {Number(q.total).toFixed(2)}</td>
                <td className="px-6 py-3 text-right">
                  <button onClick={() => print(q)} className="mr-3 text-slate-600 hover:underline">Imprimir</button>
                  {q.status === 'DRAFT' && can('quotes.manage') && (
                    <button onClick={() => setStatus(q, 'SENT')} className="mr-3 text-blue-600 hover:underline">Marcar enviada</button>
                  )}
                  {['DRAFT', 'SENT', 'ACCEPTED'].includes(q.status) && can('quotes.convert') && (
                    <button onClick={() => convert(q)} disabled={busy} className="font-semibold text-violet-600 hover:underline disabled:opacity-50">Convertir</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
