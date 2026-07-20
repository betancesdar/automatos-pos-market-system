'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface NcfSequence {
  id?: string;
  type: string;
  prefix: string;
  nextValue: number;
}

interface TenantData {
  id: string;
  name: string;
  rnc: string | null;
  phone: string | null;
  address: string | null;
  ncfSequences: NcfSequence[];
}

const NCF_TYPES = [
  { type: 'CONSUMIDOR_FINAL', label: 'B02 — Consumidor Final' },
  { type: 'CREDITO_FISCAL', label: 'B01 — Crédito Fiscal' },
  { type: 'GUBERNAMENTAL', label: 'B15 — Gubernamental' },
];

export function TenantSettingsPanel({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [name, setName] = useState('');
  const [rnc, setRnc] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [sequences, setSequences] = useState<NcfSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<TenantData>('/tenant', tenantId)
      .then((data) => {
        setTenant(data);
        setName(data.name);
        setRnc(data.rnc || '');
        setPhone(data.phone || '');
        setAddress(data.address || '');
        const merged = NCF_TYPES.map((t) => {
          const existing = data.ncfSequences.find((s) => s.type === t.type);
          return existing ?? { type: t.type, prefix: t.type === 'CREDITO_FISCAL' ? 'B01' : t.type === 'GUBERNAMENTAL' ? 'B15' : 'B02', nextValue: 1 };
        });
        setSequences(merged);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const validateRnc = (value: string) => {
    if (!value) return true;
    const digits = value.replace(/\D/g, '');
    return digits.length === 9 || digits.length === 11;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (rnc && !validateRnc(rnc)) {
      setError('El RNC debe tener 9 u 11 dígitos');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<TenantData>('/tenant', tenantId, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          rnc: rnc.replace(/\D/g, '') || null,
          phone,
          address,
          ncfSequences: sequences.map((s) => ({
            type: s.type,
            prefix: s.prefix,
            nextValue: Number(s.nextValue),
          })),
        }),
      });
      setTenant(updated);
      setMessage('Configuración guardada correctamente');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-slate-500">Cargando configuración…</p>;

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-bold text-slate-900">Datos del Negocio</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre Comercial</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">RNC (9 u 11 dígitos)</label>
            <input
              value={rnc}
              onChange={(e) => setRnc(e.target.value)}
              placeholder="123456789"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Dirección</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-bold text-slate-900">Secuencias NCF Autorizadas (DGII)</h3>
        <div className="space-y-4">
          {NCF_TYPES.map((t, i) => (
            <div key={t.type} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4 md:grid-cols-3">
              <div className="font-medium text-slate-700">{t.label}</div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Prefijo</label>
                <input
                  value={sequences[i]?.prefix ?? ''}
                  onChange={(e) => {
                    setSequences((prev) =>
                      prev.map((s, idx) => (idx === i ? { ...s, prefix: e.target.value } : s)),
                    );
                  }}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Próximo número</label>
                <input
                  type="number"
                  min={1}
                  value={sequences[i]?.nextValue ?? 1}
                  onChange={(e) => {
                    setSequences((prev) =>
                      prev.map((s, idx) =>
                        idx === i ? { ...s, nextValue: parseInt(e.target.value) || 1 } : s,
                      ),
                    );
                  }}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Guardar Configuración'}
      </button>
    </form>
  );
}
