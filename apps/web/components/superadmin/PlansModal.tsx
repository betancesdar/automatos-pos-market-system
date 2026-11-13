'use client';

import { useState, useEffect, useCallback } from 'react';
import { superadminFetch } from '../../lib/api';

interface PlanRow {
  code: string;
  name: string;
  monthlyPrice: number;
  maxUsers: number;
  maxProducts: number;
  _count?: { tenants: number };
}

const EMPTY = { code: '', name: '', monthlyPrice: '0', maxUsers: '5', maxProducts: '1000' };

export function PlansModal({ onClose }: { onClose: () => void }) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlans(await superadminFetch<PlanRow[]>('/superadmin/plans'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando planes'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await superadminFetch('/superadmin/plans', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          monthlyPrice: parseFloat(form.monthlyPrice) || 0,
          maxUsers: parseInt(form.maxUsers, 10) || 5,
          maxProducts: parseInt(form.maxProducts, 10) || 1000,
        }),
      });
      setForm({ ...EMPTY });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error guardando plan'); }
    finally { setSaving(false); }
  };

  const remove = async (code: string) => {
    if (!confirm(`¿Eliminar el plan ${code}?`)) return;
    try {
      await superadminFetch(`/superadmin/plans/${code}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error eliminando plan'); }
  };

  const input = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-bold text-white">💼 Gestión de Planes</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="space-y-4 p-6">
          {error && <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>}

          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Código</th><th>Nombre</th>
                <th className="text-right">Precio/mes</th>
                <th className="text-right">Usuarios</th>
                <th className="text-right">Productos</th>
                <th className="text-right">Tenants</th><th />
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-slate-600">Sin planes — crea el primero abajo</td></tr>
              )}
              {plans.map((p) => (
                <tr key={p.code} className="border-t border-slate-800">
                  <td className="py-2 font-mono font-bold text-violet-400">{p.code}</td>
                  <td>{p.name}</td>
                  <td className="text-right tabular-nums">RD$ {p.monthlyPrice.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{p.maxUsers}</td>
                  <td className="text-right tabular-nums">{p.maxProducts}</td>
                  <td className="text-right tabular-nums">{p._count?.tenants ?? 0}</td>
                  <td className="pl-2 text-right">
                    <button onClick={() => setForm({
                      code: p.code, name: p.name, monthlyPrice: String(p.monthlyPrice),
                      maxUsers: String(p.maxUsers), maxProducts: String(p.maxProducts),
                    })} className="mr-2 text-blue-400 hover:text-blue-300">✎</button>
                    <button onClick={() => remove(p.code)} className="text-red-400 hover:text-red-300">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="mb-3 text-xs font-bold uppercase text-slate-500">Crear / editar plan</p>
            <div className="grid grid-cols-5 gap-2">
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="CÓDIGO" className={input} />
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre" className={input} />
              <input type="number" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                placeholder="Precio/mes" className={input} />
              <input type="number" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })}
                placeholder="Max usuarios" className={input} />
              <input type="number" value={form.maxProducts} onChange={(e) => setForm({ ...form, maxProducts: e.target.value })}
                placeholder="Max productos" className={input} />
            </div>
            <button onClick={save} disabled={saving || !form.code || !form.name}
              className="mt-3 rounded-lg bg-violet-600 px-5 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuditModal({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<{
    id: string; actorUsername: string; action: string; targetTenantId: string | null;
    metadata: Record<string, unknown> | null; createdAt: string;
  }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    superadminFetch<typeof logs>('/superadmin/audit-logs?limit=200')
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error cargando auditoría'));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-bold text-white">📜 Auditoría de la Plataforma</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {error && <div className="mb-3 rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>}
          {logs.length === 0 && !error && (
            <p className="py-8 text-center text-slate-600">Sin acciones registradas aún</p>
          )}
          <div className="space-y-1">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-2 text-sm">
                <div>
                  <span className="font-bold text-violet-400">{l.action}</span>
                  <span className="ml-2 text-slate-400">por {l.actorUsername}</span>
                  {l.metadata && Object.keys(l.metadata).length > 0 && (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">{JSON.stringify(l.metadata)}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {new Date(l.createdAt).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
