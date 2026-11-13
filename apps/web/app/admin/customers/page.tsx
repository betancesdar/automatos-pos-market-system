'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch } from '../../../lib/api';
import { AdminShell } from '../../../components/admin/AdminShell';

interface Customer {
  id: string;
  name: string;
  docType: 'RNC' | 'CEDULA' | 'NONE';
  docNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: string;
  balance: string;
  isActive: boolean;
  notes: string | null;
}

const emptyForm = {
  id: '', name: '', docType: 'NONE' as Customer['docType'], docNumber: '',
  phone: '', email: '', address: '', creditLimit: '0', notes: '',
};

export default function CustomersPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      setCustomers(await apiFetch<Customer[]>(`/customers${q}`, tenantId));
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }, [tenantId, search]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm({ ...emptyForm }); setShowForm(true); setError(''); };
  const openEdit = (c: Customer) => {
    setForm({
      id: c.id, name: c.name, docType: c.docType, docNumber: c.docNumber ?? '',
      phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
      creditLimit: String(c.creditLimit ?? '0'), notes: c.notes ?? '',
    });
    setShowForm(true); setError('');
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body = JSON.stringify({
        name: form.name, docType: form.docType, docNumber: form.docNumber,
        phone: form.phone, email: form.email, address: form.address,
        creditLimit: parseFloat(form.creditLimit) || 0, notes: form.notes,
      });
      if (form.id) await apiFetch(`/customers/${form.id}`, tenantId, { method: 'PUT', body });
      else await apiFetch('/customers', tenantId, { method: 'POST', body });
      setShowForm(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error guardando'); }
    finally { setSaving(false); }
  };

  const deactivate = async (c: Customer) => {
    if (!confirm(`¿Desactivar a ${c.name}?`)) return;
    try { await apiFetch(`/customers/${c.id}`, tenantId, { method: 'DELETE' }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Error'); }
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500';

  return (
    <AdminShell title="Clientes" subtitle="Registro de clientes, contacto y límite de crédito">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, documento o teléfono…"
          className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm outline-none focus:border-indigo-500" />
        <button onClick={openNew} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
          + Nuevo cliente
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {showForm && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-900">{form.id ? 'Editar cliente' : 'Nuevo cliente'}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre / Razón social</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo de documento</label>
              <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value as Customer['docType'] })} className={input}>
                <option value="NONE">Sin documento</option>
                <option value="RNC">RNC</option>
                <option value="CEDULA">Cédula</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Número de documento</label>
              <input value={form.docNumber} onChange={(e) => setForm({ ...form, docNumber: e.target.value })}
                disabled={form.docType === 'NONE'} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Dirección</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Límite de crédito (RD$)</label>
              <input type="number" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} className={input} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Notas</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={input} />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
            <button onClick={save} disabled={saving || !form.name.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th className="px-6 py-3 text-left font-semibold">Nombre</th>
              <th className="px-4 py-3 text-left font-semibold">Documento</th>
              <th className="px-4 py-3 text-left font-semibold">Teléfono</th>
              <th className="px-4 py-3 text-right font-semibold">Límite crédito</th>
              <th className="px-4 py-3 text-right font-semibold">Balance</th>
              <th className="px-6 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-400">Sin clientes.</td></tr>
            )}
            {customers.map((c) => (
              <tr key={c.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!c.isActive ? 'opacity-50' : ''}`}>
                <td className="px-6 py-3 font-medium text-slate-900">
                  {c.name}{!c.isActive && <span className="ml-2 text-xs text-slate-400">(inactivo)</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.docType !== 'NONE' ? `${c.docType} ${c.docNumber ?? ''}` : '—'}</td>
                <td className="px-4 py-3 text-slate-600">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">RD$ {Number(c.creditLimit).toFixed(2)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${Number(c.balance) > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                  RD$ {Number(c.balance).toFixed(2)}
                </td>
                <td className="px-6 py-3 text-right">
                  <button onClick={() => openEdit(c)} className="mr-3 text-indigo-600 hover:underline">Editar</button>
                  {c.isActive && <button onClick={() => deactivate(c)} className="text-red-600 hover:underline">Desactivar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
