'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { superadminFetch } from '../../lib/api';
import { TenantDetailDrawer } from '../../components/superadmin/TenantDetailDrawer';
import { PlansModal, AuditModal } from '../../components/superadmin/PlansModal';
import { PronesoftMatrizModal } from '../../components/superadmin/PronesoftMatrizModal';

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
  address: string | null;
  users: { name: string; email: string }[];
  _count: { users: number; products: number };
}

type ModalType = 'create' | 'edit' | 'renew' | 'delete' | null;
type RenewOption = 'MONTH_1' | 'MONTH_6' | 'YEAR_1' | 'INDEFINITE';

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
  const router = useRouter();
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [renewOption, setRenewOption] = useState<RenewOption>('MONTH_1');
  const [customExpiryDate, setCustomExpiryDate] = useState('');
  const [detailTenant, setDetailTenant] = useState<TenantRow | null>(null);
  const [showPlans, setShowPlans] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showPronesoft, setShowPronesoft] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED'>('ALL');
  // Posición del menú de acciones (portal) — evita el recorte del overflow de la tabla.
  // y = borde inferior del botón, yTop = borde superior (para voltear hacia arriba).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; yTop: number } | null>(null);

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

  // Cerrar el menú de acciones al hacer clic fuera, hacer scroll o redimensionar.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const visibleTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q) && !t.rnc.toLowerCase().includes(q)) return false;
      if (statusFilter === 'ALL') return true;
      const expired = new Date(t.expiresAt) < new Date();
      if (statusFilter === 'SUSPENDED') return !t.isActive;
      if (statusFilter === 'EXPIRED') return t.isActive && expired;
      if (statusFilter === 'ACTIVE') return t.isActive && !expired;
      return true;
    });
  }, [tenants, searchQuery, statusFilter]);

  const openModal = (type: ModalType, tenant?: TenantRow) => {
    setModalType(type);
    setSelectedTenant(tenant || null);
    setError('');
    if (type === 'edit' && tenant) {
      setForm({
        ...emptyForm,
        name: tenant.name,
        rnc: tenant.rnc,
        phone: tenant.phone || '',
        address: tenant.address || '',
        plan: tenant.plan,
      });
      setCustomExpiryDate(tenant.expiresAt?.split('T')[0] || '');
    } else if (type === 'create') {
      setForm(emptyForm);
    }
    setMenu(null);
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedTenant(null);
    setError('');
    setForm(emptyForm);
    setCustomExpiryDate('');
    setRenewOption('MONTH_1');
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
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSubmitting(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${selectedTenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          rnc: form.rnc,
          phone: form.phone || null,
          address: form.address || null,
          plan: form.plan,
          expiresAt: customExpiryDate ? new Date(customExpiryDate).toISOString() : undefined,
        }),
      });
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSubmitting(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${selectedTenant.id}/renew`, {
        method: 'POST',
        body: JSON.stringify({ option: renewOption }),
      });
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al renovar tenant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTenant) return;
    setSubmitting(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${selectedTenant.id}`, {
        method: 'DELETE',
      });
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar tenant');
    } finally {
      setSubmitting(false);
    }
  };

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

  const handleImpersonate = async (tenant: TenantRow) => {
    setActionId(tenant.id);
    try {
      const response = await superadminFetch<{ token: string; tenant: any; user: any }>(
        `/superadmin/tenants/${tenant.id}/impersonate`,
        { method: 'POST' }
      );
      
      // Store impersonation token and context
      localStorage.setItem('impersonation_token', response.token);
      localStorage.setItem('impersonation_tenant', JSON.stringify(response.tenant));
      localStorage.setItem('original_auth', 'true');
      
      // Redirect to POS
      router.push('/pos');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al iniciar impersonación');
    } finally {
      setActionId(null);
    }
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  const getStatus = (tenant: TenantRow) => {
    if (!tenant.isActive) return { label: 'SUSPENDIDO', color: 'bg-amber-500/20 text-amber-400' };
    if (isExpired(tenant.expiresAt)) return { label: 'EXPIRADO', color: 'bg-red-500/20 text-red-400' };
    return { label: 'ACTIVO', color: 'bg-emerald-500/20 text-emerald-400' };
  };

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Todos los Comercios</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowPronesoft(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">
              ⚡ Pronesoft (matriz)
            </button>
            <button onClick={() => setShowAudit(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">
              📜 Auditoría
            </button>
            <button onClick={() => setShowPlans(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">
              💼 Planes
            </button>
            <button onClick={load} disabled={loading} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50">
              {loading ? 'Cargando…' : '↻ Actualizar'}
            </button>
            <button onClick={() => openModal('create')} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold hover:bg-violet-500">
              + Registrar Minimarket
            </button>
          </div>
        </div>

        {/* Buscador + filtro de estado */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre o RNC…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm outline-none focus:border-violet-500"
          />
          <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            {([
              ['ALL', 'Todos'],
              ['ACTIVE', 'Activos'],
              ['SUSPENDED', 'Suspendidos'],
              ['EXPIRED', 'Por vencer'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">{visibleTenants.length} de {tenants.length}</span>
        </div>

        {/* Tenants table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="px-6 py-3 text-left font-semibold">Nombre</th>
                <th className="px-4 py-3 text-left font-semibold">RNC</th>
                <th className="px-4 py-3 text-left font-semibold">Plan</th>
                <th className="px-4 py-3 text-left font-semibold">Vencimiento</th>
                <th className="px-4 py-3 text-left font-semibold">Estado</th>
                <th className="px-6 py-3 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleTenants.map((t) => {
                const status = getStatus(t);
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
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenu(menu?.id === t.id ? null : { id: t.id, x: r.right, y: r.bottom, yTop: r.top });
                        }}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                      >
                        Acciones ▾
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && visibleTenants.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500">
                  {tenants.length === 0 ? 'No hay comercios registrados.' : 'Ningún comercio coincide con el filtro.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Menú de acciones (portal) — posicionado en coordenadas fijas, nunca recortado.
          Si no hay espacio abajo, se abre hacia arriba para no cortarse. */}
      {menu && (() => {
        const t = tenants.find((x) => x.id === menu.id);
        if (!t) return null;
        const MENU_H = 320; // alto aproximado de los 6 ítems
        const openUp = typeof window !== 'undefined' && window.innerHeight - menu.y < MENU_H;
        const posStyle = openUp
          ? { bottom: (typeof window !== 'undefined' ? window.innerHeight : 0) - menu.yTop + 4, left: menu.x }
          : { top: menu.y + 4, left: menu.x };
        return createPortal(
          <div
            className="fixed z-[200] max-h-[85vh] w-56 -translate-x-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
            style={posStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => { setDetailTenant(t); setMenu(null); }}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-cyan-400 hover:bg-slate-800">
              📋 Detalles & Config
            </button>
            <button onClick={() => { handleImpersonate(t); setMenu(null); }} disabled={actionId === t.id}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-violet-400 hover:bg-slate-800 disabled:opacity-50">
              🔐 Ingresar como Comercio
            </button>
            <button onClick={() => openModal('renew', t)}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-emerald-400 hover:bg-slate-800">
              ✓ Renovar / Activar
            </button>
            <button onClick={() => openModal('edit', t)}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-blue-400 hover:bg-slate-800">
              ✎ Editar Comercio
            </button>
            <button onClick={() => { toggleActive(t); setMenu(null); }} disabled={actionId === t.id}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-amber-400 hover:bg-slate-800 disabled:opacity-50">
              {t.isActive ? '⏸ Suspender' : '▶ Reactivar'}
            </button>
            <button onClick={() => openModal('delete', t)}
              className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-400 hover:bg-slate-800">
              🗑 Eliminar
            </button>
          </div>,
          document.body,
        );
      })()}

      {/* Create Tenant Modal */}
      {modalType === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-800 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Registrar Nuevo Minimarket</h3>
              <p className="text-sm text-slate-500">Licencia activa por 1 año automáticamente</p>
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
                  <option value="ENTERPRISE">ENTERPRISE</option>
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
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-slate-700 py-2.5 font-medium text-slate-400">
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

      {/* Edit Tenant Modal */}
      {modalType === 'edit' && selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-800 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Editar Comercio</h3>
              <p className="text-sm text-slate-500">{selectedTenant.name}</p>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4 px-6 py-5">
              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Nombre Comercial</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">RNC</label>
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
                  <option value="ENTERPRISE">ENTERPRISE</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-400">Fecha de Expiración</label>
                <input 
                  type="date" 
                  value={customExpiryDate} 
                  onChange={(e) => setCustomExpiryDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-violet-500" 
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-slate-700 py-2.5 font-medium text-slate-400">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-blue-600 py-2.5 font-semibold text-white disabled:opacity-50">
                  {submitting ? 'Guardando…' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Renew Tenant Modal */}
      {modalType === 'renew' && selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-800 px-6 py-4">
              <h3 className="text-lg font-bold text-white">Renovar / Activar</h3>
              <p className="text-sm text-slate-500">{selectedTenant.name}</p>
            </div>
            <form onSubmit={handleRenew} className="space-y-4 px-6 py-5">
              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-400">Extender licencia por:</label>
                <div className="space-y-2">
                  {[
                    { value: 'MONTH_1', label: '+1 Mes' },
                    { value: 'MONTH_6', label: '+6 Meses' },
                    { value: 'YEAR_1', label: '+1 Año' },
                    { value: 'INDEFINITE', label: 'Indefinido (2099-12-31)' },
                  ].map((opt) => (
                    <label key={opt.value} className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 cursor-pointer hover:bg-slate-750">
                      <input
                        type="radio"
                        name="renewOption"
                        value={opt.value}
                        checked={renewOption === opt.value}
                        onChange={(e) => setRenewOption(e.target.value as RenewOption)}
                        className="h-4 w-4"
                      />
                      <span className="text-white">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                * Esta acción también activará el comercio (isActive = true)
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-slate-700 py-2.5 font-medium text-slate-400">
                  Cancelar
                </button>
                <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-emerald-600 py-2.5 font-semibold text-white disabled:opacity-50">
                  {submitting ? 'Renovando…' : 'Renovar y Activar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Tenant Modal */}
      {modalType === 'delete' && selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-red-700 bg-slate-900 shadow-2xl">
            <div className="border-b border-red-800 bg-red-950/50 px-6 py-4">
              <h3 className="text-lg font-bold text-red-400">⚠️ Confirmar Eliminación</h3>
            </div>
            <div className="space-y-4 px-6 py-5">
              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
              <p className="text-slate-300">
                ¿Estás seguro de que deseas eliminar el comercio <strong className="text-white">{selectedTenant.name}</strong>?
              </p>
              <div className="rounded-lg bg-red-950/30 border border-red-800/50 px-4 py-3">
                <p className="text-sm font-semibold text-red-400">Esta acción:</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-400">
                  <li>• Eliminará todos los usuarios</li>
                  <li>• Eliminará todos los productos</li>
                  <li>• Eliminará todas las ventas e historial</li>
                  <li>• No se puede deshacer</li>
                </ul>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="flex-1 rounded-lg border border-slate-700 py-2.5 font-medium text-slate-400">
                  Cancelar
                </button>
                <button onClick={handleDelete} disabled={submitting} className="flex-1 rounded-lg bg-red-600 py-2.5 font-semibold text-white disabled:opacity-50">
                  {submitting ? 'Eliminando…' : 'Sí, Eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailTenant && (
        <TenantDetailDrawer
          tenant={detailTenant}
          onClose={() => setDetailTenant(null)}
          onChanged={load}
        />
      )}
      {showPlans && <PlansModal onClose={() => setShowPlans(false)} />}
      {showAudit && <AuditModal onClose={() => setShowAudit(false)} />}
      {showPronesoft && <PronesoftMatrizModal onClose={() => setShowPronesoft(false)} />}
    </div>
  );
}
