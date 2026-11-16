'use client';

import { useEffect, useState } from 'react';
import { superadminFetch } from '../../lib/api';

interface PlatformCfg {
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
}

export function PronesoftMatrizModal({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<PlatformCfg | null>(null);
  const [form, setForm] = useState({ enabled: false, clientId: '', clientSecret: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = async () => {
    try {
      const c = await superadminFetch<PlatformCfg>('/superadmin/ecf/platform-config');
      setCfg(c);
      setForm((f) => ({ ...f, enabled: c.enabled, clientId: c.clientId }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await superadminFetch('/superadmin/ecf/platform-config', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: form.enabled,
          clientId: form.clientId || undefined,
          clientSecret: form.clientSecret || undefined,
        }),
      });
      setForm((f) => ({ ...f, clientSecret: '' }));
      setNotice('Credenciales de la matriz guardadas');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error guardando'); }
    finally { setSaving(false); }
  };

  const testConnection = async () => {
    setTesting(true); setError(''); setNotice('');
    try {
      const list = await superadminFetch<unknown[]>('/superadmin/ecf/associated-companies');
      const n = Array.isArray(list) ? list.length : 0;
      setNotice(`✓ Conexión OK — ${n} empresa(s) asociada(s) encontrada(s)`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falló la conexión'); }
    finally { setTesting(false); }
  };

  const input = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-bold text-white">⚡ Pronesoft (empresa matriz)</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <p className="text-xs text-slate-400">
            Una sola credencial (tu App matriz) opera por todas las empresas asociadas vía <code className="text-slate-300">x-tenant-id</code>.
            El secret es de solo escritura (se guarda cifrado).
          </p>
          <div className="rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-2 text-xs text-amber-300">
            ⚠️ Facturación electrónica <b>real</b> (producción · DGII). Los e-CF que se emitan son válidos ante la DGII.
          </div>
          {error && <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>}
          {notice && <div className="rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-2 text-sm text-emerald-300">{notice}</div>}

          <button onClick={() => setForm({ ...form, enabled: !form.enabled })}
            className={`w-full rounded-lg border px-3 py-2 text-sm font-bold ${form.enabled ? 'border-emerald-700 bg-emerald-950 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
            {form.enabled ? '✓ e-CF Habilitado' : 'e-CF Deshabilitado'}
          </button>

          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase text-slate-500">Credenciales Pronesoft {cfg?.hasSecret && <span className="text-emerald-400">✓ secret guardado</span>}</p>
            <input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="Client ID" className={`${input} mb-2`} />
            <input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} placeholder={cfg?.hasSecret ? '•••••• (vacío = no cambiar)' : 'Client Secret'} className={input} />
          </div>

          <div className="flex gap-3">
            <button onClick={testConnection} disabled={testing} className="flex-1 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
              {testing ? 'Probando…' : '🔌 Probar conexión'}
            </button>
            <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
