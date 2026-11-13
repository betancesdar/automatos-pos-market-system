'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface PermissionDef { code: string; label: string; group: string }
interface Catalog { groups: { group: string; permissions: PermissionDef[] }[] }
interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissionCodes: string[];
  isSystem: boolean;
  userCount: number;
}
interface BaseRole { code: string; permissionCodes: string[] }
interface RolesResponse { baseRoles: BaseRole[]; customRoles: CustomRole[] }

const BASE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  CASHIER: 'Cajero',
  BILLER: 'Facturador',
  ACCOUNTANT: 'Contable',
};

const emptyForm = { id: '', name: '', description: '', permissionCodes: [] as string[] };

export function RolesPanel({ tenantId }: { tenantId: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [roles, setRoles] = useState<RolesResponse | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        apiFetch<Catalog>('/roles/permissions', tenantId),
        apiFetch<RolesResponse>('/roles', tenantId),
      ]);
      setCatalog(c);
      setRoles(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando roles');
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const labelFor = (code: string) => {
    for (const g of catalog?.groups ?? []) {
      const p = g.permissions.find((x) => x.code === code);
      if (p) return p.label;
    }
    return code;
  };

  const toggle = (code: string) => {
    setForm((f) => ({
      ...f,
      permissionCodes: f.permissionCodes.includes(code)
        ? f.permissionCodes.filter((c) => c !== code)
        : [...f.permissionCodes, code],
    }));
  };

  const toggleGroup = (group: PermissionDef[]) => {
    const codes = group.map((p) => p.code);
    const allOn = codes.every((c) => form.permissionCodes.includes(c));
    setForm((f) => ({
      ...f,
      permissionCodes: allOn
        ? f.permissionCodes.filter((c) => !codes.includes(c))
        : [...new Set([...f.permissionCodes, ...codes])],
    }));
  };

  const startNew = () => { setForm({ ...emptyForm }); setEditing(true); setError(''); };
  const startEdit = (r: CustomRole) => {
    setForm({ id: r.id, name: r.name, description: r.description ?? '', permissionCodes: [...r.permissionCodes] });
    setEditing(true);
    setError('');
  };
  const cancel = () => { setForm({ ...emptyForm }); setEditing(false); setError(''); };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = JSON.stringify({
        name: form.name,
        description: form.description,
        permissionCodes: form.permissionCodes,
      });
      if (form.id) {
        await apiFetch(`/roles/${form.id}`, tenantId, { method: 'PATCH', body });
      } else {
        await apiFetch('/roles', tenantId, { method: 'POST', body });
      }
      cancel();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando rol');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: CustomRole) => {
    if (!confirm(`¿Eliminar el rol "${r.name}"?`)) return;
    setError('');
    try {
      await apiFetch(`/roles/${r.id}`, tenantId, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error eliminando rol');
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {/* Roles base del sistema (referencia, solo lectura) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="mb-1 text-sm font-bold text-slate-900">Roles base del sistema</h4>
        <p className="mb-3 text-xs text-slate-500">
          Cada empleado tiene un rol base. Puedes sumarle un rol personalizado para ampliar sus permisos.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {roles?.baseRoles.map((b) => (
            <div key={b.code} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-bold text-slate-800">{BASE_LABELS[b.code] ?? b.code}</p>
              <p className="text-xs text-slate-500">
                {b.permissionCodes.includes('*') ? 'Todos los permisos' : `${b.permissionCodes.length} permisos`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Roles personalizados */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900">Roles personalizados</h4>
          {!editing && (
            <button onClick={startNew} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              + Nuevo rol
            </button>
          )}
        </div>

        {!editing && (
          <div className="space-y-2">
            {roles && roles.customRoles.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Aún no hay roles personalizados.</p>
            )}
            {roles?.customRoles.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{r.name}
                    <span className="ml-2 text-xs font-normal text-slate-400">{r.userCount} empleado(s)</span>
                  </p>
                  {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
                  <p className="mt-1 flex flex-wrap gap-1">
                    {r.permissionCodes.map((c) => (
                      <span key={c} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">
                        {labelFor(c)}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(r)} className="text-sm font-medium text-blue-600 hover:text-blue-500">Editar</button>
                  <button onClick={() => remove(r)} className="text-sm font-medium text-red-600 hover:text-red-500">Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre del rol (ej. Supervisor)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción (opcional)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-3">
              {catalog?.groups.map((g) => {
                const allOn = g.permissions.every((p) => form.permissionCodes.includes(p.code));
                return (
                  <div key={g.group} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{g.group}</p>
                      <button onClick={() => toggleGroup(g.permissions)} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                        {allOn ? 'Quitar todos' : 'Marcar todos'}
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {g.permissions.map((p) => (
                        <label key={p.code} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.permissionCodes.includes(p.code)}
                            onChange={() => toggle(p.code)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={cancel} className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name.trim() || form.permissionCodes.length === 0}
                className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear rol'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
