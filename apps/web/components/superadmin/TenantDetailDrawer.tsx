'use client';

import { useState, useEffect, useCallback } from 'react';
import { superadminFetch } from '../../lib/api';

interface TenantLite {
  id: string;
  name: string;
  rnc: string;
  plan: string;
}

interface TenantMetrics {
  range: string;
  salesCount: number;
  revenue: number;
  itbis: number;
  byDay: { day: string; count: number; revenue: number }[];
}

interface NcfSequence {
  id: string;
  type: string;
  prefix: string;
  nextValue: number;
}

interface PlanRow {
  code: string;
  name: string;
  monthlyPrice: number;
  maxUsers: number;
  maxProducts: number;
  _count?: { tenants: number };
}

const NCF_TYPES = [
  'CONSUMIDOR_FINAL',
  'CREDITO_FISCAL',
  'GUBERNAMENTAL',
  'REGISTRO_UNICO_INGRESO',
];

function money(n: number | undefined | null) {
  return `RD$ ${(n ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function TenantDetailDrawer({
  tenant,
  onClose,
  onChanged,
}: {
  tenant: TenantLite;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'metrics' | 'fiscal' | 'plan'>('metrics');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Métricas
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);

  // Fiscal
  const [sequences, setSequences] = useState<NcfSequence[]>([]);
  const [seqForm, setSeqForm] = useState({ type: 'CONSUMIDOR_FINAL', prefix: 'B02', nextValue: '1' });
  const [ecf, setEcf] = useState<{ enabled: boolean; environment: string; clientId: string; hasSecret: boolean } | null>(null);
  const [ecfForm, setEcfForm] = useState({ enabled: false, environment: 'sandbox', clientId: '', clientSecret: '' });

  // Plan & modo
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planCode, setPlanCode] = useState('');
  const [workflowMode, setWorkflowMode] = useState('DIRECT');
  const [saving, setSaving] = useState(false);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 3500); };
  const fail = (e: unknown, f: string) => setError(e instanceof Error ? e.message : f);

  const loadMetrics = useCallback(async () => {
    try {
      setMetrics(await superadminFetch<TenantMetrics>(`/superadmin/tenants/${tenant.id}/metrics?range=${range}`));
    } catch (e) { fail(e, 'Error cargando métricas'); }
  }, [tenant.id, range]);

  const loadFiscal = useCallback(async () => {
    try {
      const [seqs, cfg] = await Promise.all([
        superadminFetch<NcfSequence[]>(`/superadmin/tenants/${tenant.id}/ncf-sequences`),
        superadminFetch<{ enabled: boolean; environment: string; clientId: string; hasSecret: boolean }>(
          `/superadmin/tenants/${tenant.id}/ecf-config`,
        ),
      ]);
      setSequences(seqs);
      setEcf(cfg);
      setEcfForm({ enabled: cfg.enabled, environment: cfg.environment, clientId: cfg.clientId, clientSecret: '' });
    } catch (e) { fail(e, 'Error cargando configuración fiscal'); }
  }, [tenant.id]);

  const loadPlan = useCallback(async () => {
    try {
      const [planList, tenantRow] = await Promise.all([
        superadminFetch<PlanRow[]>('/superadmin/plans'),
        superadminFetch<{ planCode?: string | null; workflowMode?: string }[]>('/superadmin/tenants').then(
          (rows: any[]) => rows.find((r) => r.id === tenant.id),
        ),
      ]);
      setPlans(planList);
      if (tenantRow) {
        setPlanCode(tenantRow.planCode ?? '');
        setWorkflowMode(tenantRow.workflowMode ?? 'DIRECT');
      }
    } catch (e) { fail(e, 'Error cargando planes'); }
  }, [tenant.id]);

  useEffect(() => {
    setError('');
    if (tab === 'metrics') loadMetrics();
    if (tab === 'fiscal') loadFiscal();
    if (tab === 'plan') loadPlan();
  }, [tab, loadMetrics, loadFiscal, loadPlan]);

  const saveSequence = async () => {
    setSaving(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${tenant.id}/ncf-sequences`, {
        method: 'POST',
        body: JSON.stringify({
          type: seqForm.type,
          prefix: seqForm.prefix,
          nextValue: parseInt(seqForm.nextValue, 10) || 1,
        }),
      });
      flash('Secuencia NCF guardada');
      loadFiscal();
    } catch (e) { fail(e, 'Error guardando secuencia'); }
    finally { setSaving(false); }
  };

  const deleteSequence = async (type: string) => {
    if (!confirm(`¿Eliminar la secuencia ${type}?`)) return;
    try {
      await superadminFetch(`/superadmin/tenants/${tenant.id}/ncf-sequences/${type}`, { method: 'DELETE' });
      loadFiscal();
    } catch (e) { fail(e, 'Error eliminando secuencia'); }
  };

  const saveEcf = async () => {
    setSaving(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${tenant.id}/ecf-config`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: ecfForm.enabled,
          environment: ecfForm.environment,
          clientId: ecfForm.clientId || undefined,
          clientSecret: ecfForm.clientSecret || undefined,
        }),
      });
      setEcfForm((f) => ({ ...f, clientSecret: '' }));
      flash('Configuración e-CF guardada');
      loadFiscal();
    } catch (e) { fail(e, 'Error guardando e-CF'); }
    finally { setSaving(false); }
  };

  const savePlanAndMode = async () => {
    setSaving(true);
    setError('');
    try {
      await superadminFetch(`/superadmin/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          planCode: planCode || undefined,
          workflowMode,
        }),
      });
      flash('Plan y modo de operación guardados');
      onChanged();
    } catch (e) { fail(e, 'Error guardando plan'); }
    finally { setSaving(false); }
  };

  const input = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-700 bg-slate-900 text-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">{tenant.name}</h2>
            <p className="text-xs text-slate-500">RNC {tenant.rnc}</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            ✕ Cerrar
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-700 px-6">
          {([
            ['metrics', '📈 Métricas'],
            ['fiscal', '🧾 Fiscal (NCF + e-CF)'],
            ['plan', '💼 Plan & Modo'],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`border-b-2 px-4 py-3 text-sm font-semibold ${
                tab === key ? 'border-violet-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 p-6">
          {error && <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">{error}</div>}
          {notice && <div className="rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-2 text-sm text-emerald-300">✓ {notice}</div>}

          {/* ── MÉTRICAS ── */}
          {tab === 'metrics' && (
            <>
              <div className="flex gap-2">
                {([['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días']] as const).map(([r, label]) => (
                  <button key={r} onClick={() => setRange(r)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                      range === r ? 'border-violet-500 bg-violet-950 text-violet-300' : 'border-slate-700 text-slate-400'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {metrics && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                      <p className="text-xs text-slate-500">Ventas</p>
                      <p className="text-2xl font-black text-white">{metrics.salesCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                      <p className="text-xs text-slate-500">Ingresos</p>
                      <p className="text-xl font-black text-emerald-400">{money(metrics.revenue)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                      <p className="text-xs text-slate-500">ITBIS</p>
                      <p className="text-xl font-black text-white">{money(metrics.itbis)}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                    <p className="mb-2 text-xs font-bold uppercase text-slate-500">Por día</p>
                    {metrics.byDay.length === 0 && <p className="py-4 text-center text-sm text-slate-600">Sin ventas en el rango</p>}
                    {metrics.byDay.map((d) => (
                      <div key={d.day} className="flex items-center justify-between border-b border-slate-800 py-1.5 text-sm">
                        <span className="text-slate-400">{d.day}</span>
                        <span className="text-slate-500">{d.count} ventas</span>
                        <span className="font-bold tabular-nums text-white">{money(d.revenue)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── FISCAL ── */}
          {tab === 'fiscal' && (
            <>
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <p className="mb-3 text-xs font-bold uppercase text-slate-500">Secuencias NCF</p>
                {sequences.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-slate-800 py-2 text-sm">
                    <span className="font-semibold text-white">{s.type}</span>
                    <span className="font-mono text-slate-400">{s.prefix} · próx: {s.nextValue}</span>
                    <button onClick={() => deleteSequence(s.type)} className="text-red-400 hover:text-red-300">✕</button>
                  </div>
                ))}
                {sequences.length === 0 && (
                  <p className="py-2 text-sm text-amber-400">⚠️ Sin secuencias — las ventas fiscales saldrán SIN NCF</p>
                )}
                <div className="mt-3 grid grid-cols-4 gap-2">
                  <select value={seqForm.type} onChange={(e) => setSeqForm({ ...seqForm, type: e.target.value })} className={input}>
                    {NCF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input value={seqForm.prefix} onChange={(e) => setSeqForm({ ...seqForm, prefix: e.target.value })}
                    placeholder="Prefijo (B02)" className={input} />
                  <input type="number" min="1" value={seqForm.nextValue}
                    onChange={(e) => setSeqForm({ ...seqForm, nextValue: e.target.value })}
                    placeholder="Próximo #" className={input} />
                  <button onClick={saveSequence} disabled={saving}
                    className="rounded-lg bg-violet-600 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50">
                    Guardar
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <p className="mb-3 text-xs font-bold uppercase text-slate-500">
                  Facturación Electrónica e-CF (Pronesoft)
                  {ecf?.hasSecret && <span className="ml-2 text-emerald-400">credenciales guardadas ✓</span>}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setEcfForm({ ...ecfForm, enabled: !ecfForm.enabled })}
                    className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                      ecfForm.enabled ? 'border-emerald-700 bg-emerald-950 text-emerald-300' : 'border-slate-700 text-slate-500'
                    }`}>
                    {ecfForm.enabled ? '✓ Habilitado' : 'Deshabilitado'}
                  </button>
                  <select value={ecfForm.environment} onChange={(e) => setEcfForm({ ...ecfForm, environment: e.target.value })} className={input}>
                    <option value="sandbox">Sandbox (pruebas)</option>
                    <option value="prod">Producción</option>
                  </select>
                  <input value={ecfForm.clientId} onChange={(e) => setEcfForm({ ...ecfForm, clientId: e.target.value })}
                    placeholder="Client ID" className={input} />
                  <input type="password" value={ecfForm.clientSecret}
                    onChange={(e) => setEcfForm({ ...ecfForm, clientSecret: e.target.value })}
                    placeholder={ecf?.hasSecret ? '•••••• (vacío = no cambiar)' : 'Client Secret'} className={input} />
                </div>
                <button onClick={saveEcf} disabled={saving}
                  className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50">
                  Guardar e-CF
                </button>
              </div>
            </>
          )}

          {/* ── PLAN & MODO ── */}
          {tab === 'plan' && (
            <>
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <p className="mb-3 text-xs font-bold uppercase text-slate-500">Modo de operación del POS</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setWorkflowMode('DIRECT')}
                    className={`rounded-xl border p-4 text-left ${
                      workflowMode === 'DIRECT' ? 'border-violet-500 bg-violet-950' : 'border-slate-700'
                    }`}>
                    <p className="font-bold text-white">Directo</p>
                    <p className="text-xs text-slate-400">El cajero factura y cobra en la misma estación (clásico)</p>
                  </button>
                  <button onClick={() => setWorkflowMode('BILLER_CASHIER')}
                    className={`rounded-xl border p-4 text-left ${
                      workflowMode === 'BILLER_CASHIER' ? 'border-violet-500 bg-violet-950' : 'border-slate-700'
                    }`}>
                    <p className="font-bold text-white">Facturador + Caja</p>
                    <p className="text-xs text-slate-400">Facturadores arman pedidos (#código) y el cliente paga en caja central</p>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                <p className="mb-3 text-xs font-bold uppercase text-slate-500">Plan con límites</p>
                <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className={input}>
                  <option value="">— Sin plan (sin límites) —</option>
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name} · {p.maxUsers} usuarios · {p.maxProducts} productos · {money(p.monthlyPrice)}/mes
                    </option>
                  ))}
                </select>
                {plans.length === 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    No hay planes creados — créalos desde el botón “Planes” del panel principal.
                  </p>
                )}
              </div>

              <button onClick={savePlanAndMode} disabled={saving}
                className="w-full rounded-xl bg-violet-600 py-3 font-bold text-white hover:bg-violet-500 disabled:opacity-50">
                {saving ? 'Guardando…' : 'Guardar Plan & Modo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
