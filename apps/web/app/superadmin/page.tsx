'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { superadminFetch } from '../../lib/api';

interface Metrics {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
}

interface TenantRow {
  id: string;
  name: string;
  rnc: string;
  plan: string;
  isActive: boolean;
  expiresAt: string;
  phone: string | null;
  users: { name: string; email: string }[];
  _count: { users: number; products: number };
}

const emptyForm = {
  name: '',
  rnc: '',
  phone: '',
  address: '',
  plan: 'BASIC',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
};

export default function SuperadminPage() {
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, t] = await Promise.all([
        superadminFetch<Metrics>('/superadmin/metrics'),
        superadminFetch<TenantRow[]>('/superadmin/tenants'),
      ]);
      setMetrics(m);
      setTenants(t);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (tenant: TenantRow) => {
    setActionId(tenant.id);
    try {
      await superadminFetch(`/superadmin/tenants/${tenant.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !tenant.isActive }),
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error');
    } finally {
      setActionId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await superadminFetch('/superadmin/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setShowModal(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Panel de Darío</p>
            <h1 className="text-xl font-bold">MiniMarket OS · Super Admin</h1>
            {user && <p className="text-sm text-slate-500">{user.name}</p>}
          </div>
          <button onClick={logout} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-white">
            Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: 'Total Minimarkets', value: metrics?.totalTenants ?? '—', color: 'text-white' },
            { label: 'Clientes Activos', value: metrics?.activeTenants ?? '—', color: 'text-emerald-400' },
            { label: 'Clientes Suspendidos', value: metrics?.suspendedTenants ?? '—', color: 'text-red-400' },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{m.label}</p>
              <p className={`mt-2 text-4xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Actions bar */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Todos los Comercios</h2>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
            <button onClick={() => { setShowModal(true); setError(''); }} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500">
              + Registrar Minimarket
            </button>
          </div>
        </div>

        {/* Tenants table */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="px-6 py-3 text-left font-semibold">Nombre</th>
                <th className="px-4 py-3 text-left font-semibold">RNC</th>
                <th className="px-4 py-3 text-left font-semibold">Plan</th>
                <th className="px-4 py-3 text-left font-semibold">Vencimiento</th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-6 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const expired = isExpired(t.expiresAt);
                const status = !t.isActive ? 'SUSPENDIDO' : expired ? 'EXPIRADO' : 'ACTIVO';
                return (
                  <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-white">{t.name}</p>
                      <p className="text-xs text-slate-500">{t.users[0]?.email ?? 'Sin admin'}</p>
                    </td>
                    <td className="px-4 py-4 font-mono text-slate-400">{t.rnc}</td>
                    <td className="px-4 py-4">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold">{t.plan}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-400">
                      {new Date(t.expiresAt).toLocaleDateString('es-DO')}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                        status === 'ACTIVO' ? 'bg-emerald-500/20 text-emerald-400' :
                        status === 'EXPIRADO' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => toggleActive(t)}
                        disabled={actionId === t.id}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                          t.isActive
                            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        }`}
                      >
                        {actionId === t.id ? '…' : t.isActive ? 'SUSPENDER' : 'ACTIVAR'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && tenants.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500">No hay comercios registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Create Tenant Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-800 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Registrar Nuevo Minimarket</h3>
              <p className="text-sm text-slate-500">Licencia BASIC activa por 30 días automáticamente</p>
            </div>
            <form onSubmit={handleCreate} className="space-y-4 px-6 py-5">
              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Nombre Comercial</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">RNC (9 u 11 dígitos)</label>
                <input value={form.rnc} onChange={(e) => setForm({ ...form, rnc: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Teléfono</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Dirección</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Plan</label>
                <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white">
                  <option value="BASIC">BASIC</option>
                  <option value="PREMIUM">PREMIUM</option>
                </select>
              </div>
              <hr className="border-slate-800" />
              <p className="text-sm font-semibold text-slate-300">Usuario ADMIN (dueño del colmado)</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Nombre del dueño</label>
                <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Correo</label>
                <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Contraseña</label>
                <input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-lg border border-slate-700 py-2.5 font-medium text-slate-400">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-violet-600 py-2.5 font-semibold text-white disabled:opacity-50">
                  {submitting ? 'Creando…' : 'Crear Minimarket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
