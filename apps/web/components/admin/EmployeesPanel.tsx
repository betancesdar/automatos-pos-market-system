'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Employee {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: 'ADMIN' | 'CASHIER';
  createdAt: string;
}

const emptyForm: { name: string; username: string; email: string; password: string; role: 'ADMIN' | 'CASHIER' } = {
  name: '', username: '', email: '', password: '', role: 'CASHIER',
};

export function EmployeesPanel({ tenantId }: { tenantId: string }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Employee[]>('/users', tenantId);
      setEmployees(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar empleados');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setError('');
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({ name: emp.name, username: emp.username, email: emp.email ?? '', password: '', role: emp.role });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (editingId) {
        const body: Record<string, string | null> = {
          name: form.name,
          username: form.username,
          email: form.email || null,
          role: form.role,
        };
        if (form.password) body.password = form.password;
        await apiFetch(`/users/${editingId}`, tenantId, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        if (!form.password) throw new Error('La contraseña es obligatoria para nuevos empleados');
        await apiFetch('/users', tenantId, {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar empleado "${name}"?`)) return;
    try {
      await apiFetch(`/users/${id}`, tenantId, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Admin: acceso completo · Cajero: solo terminal POS
        </p>
        <button
          onClick={openCreate}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          + Nuevo Empleado
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 font-bold text-slate-900">
            {editingId ? 'Editar Empleado' : 'Nuevo Empleado'}
          </h3>
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Usuario</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoComplete="username"
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Correo <span className="text-slate-400">(opcional)</span></label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Contraseña {editingId && '(dejar vacío para no cambiar)'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingId}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Rol</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'CASHIER' })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="ADMIN">ADMIN — Acceso completo</option>
                <option value="CASHIER">CASHIER — Solo POS</option>
              </select>
            </div>
            <div className="flex gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th className="px-6 py-3 text-left font-semibold">Nombre</th>
              <th className="px-4 py-3 text-left font-semibold">Usuario</th>
              <th className="px-4 py-3 text-left font-semibold">Correo</th>
              <th className="px-4 py-3 text-left font-semibold">Rol</th>
              <th className="px-6 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : employees.map((emp) => (
              <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-6 py-3 font-medium text-slate-900">{emp.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.username}</td>
                <td className="px-4 py-3 text-slate-600">{emp.email ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    emp.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {emp.role}
                  </span>
                </td>
                <td className="px-6 py-3 text-right">
                  <button onClick={() => openEdit(emp)} className="mr-3 text-indigo-600 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => handleDelete(emp.id, emp.name)} className="text-red-600 hover:underline">
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
