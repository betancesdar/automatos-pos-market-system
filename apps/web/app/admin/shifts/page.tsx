'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch, LicenseBlockedError } from '../../../lib/api';
import { formatCurrency, formatDateTime } from '../../../lib/format';
import { printDocument, escapeHtml } from '../../../lib/print';
import { AdminShell, MetricCard, Card } from '../../../components/admin/AdminShell';

interface CashMovement {
  id: string;
  type: 'INFLOW' | 'OUTFLOW';
  amount: number;
  reason: string;
  createdAt: string;
  cashSession?: { user?: { name: string } | null } | null;
}

interface LiveShift {
  sessionId: string;
  cashier: { name: string } | null;
  openedAt: string;
  openingBalance: number;
  cashSales: number;
  cardSales: number;
  transferSales: number;
  cashRefunds: number;
  extraInflows: number;
  withdrawals: number;
  totalMovements: number;
  expectedCash: number;
  movements: CashMovement[];
}

interface ShiftSession {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingBalance: number;
  expectedClosingBalance: number | null;
  actualClosingBalance: number | null;
  status: string;
  user?: { name: string } | null;
}

interface ShiftSummary {
  periodIncome: number;
  periodExpenses: number;
  netDifference: number;
  movements: CashMovement[];
  sessions: ShiftSession[];
}

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'daily', label: 'Diario' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'custom', label: 'Personalizado' },
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPeriod(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = ymd(now);
  const start = new Date(now);
  switch (period) {
    case 'daily':
      break; // start = today
    case 'weekly':
      start.setDate(now.getDate() - 6);
      break;
    case 'monthly':
      start.setMonth(now.getMonth() - 1);
      break;
    case 'quarterly':
      start.setMonth(now.getMonth() - 3);
      break;
    default:
      break;
  }
  return { from: ymd(start), to };
}

function BreakdownRow({ label, value, accent, strong }: { label: string; value: number; accent?: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${strong ? 'border-t border-slate-200 pt-3' : 'border-b border-slate-100'}`}>
      <span className={strong ? 'text-sm font-bold text-slate-800' : 'text-sm text-slate-600'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-lg font-bold' : 'text-sm font-semibold'} ${accent ?? 'text-slate-800'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

export default function ShiftsPage() {
  const { user, setLicenseBlocked } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [period, setPeriod] = useState<Period>('daily');
  const [customFrom, setCustomFrom] = useState(ymd(new Date()));
  const [customTo, setCustomTo] = useState(ymd(new Date()));

  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [live, setLive] = useState<LiveShift | null>(null);
  const [loading, setLoading] = useState(true);

  // Movement modal
  const [movementForm, setMovementForm] = useState<{ type: 'INFLOW' | 'OUTFLOW'; amount: string; reason: string } | null>(null);
  const [savingMovement, setSavingMovement] = useState(false);
  const [movementError, setMovementError] = useState('');

  const range = useMemo(() => {
    if (period === 'custom') return { from: customFrom, to: customTo };
    return rangeForPeriod(period);
  }, [period, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [sum, liveShift] = await Promise.all([
        apiFetch<ShiftSummary>(`/cash-sessions/shifts/summary?from=${range.from}&to=${range.to}`, tenantId),
        apiFetch<LiveShift | null>('/cash-sessions/live', tenantId),
      ]);
      setSummary(sum);
      setLive(liveShift);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, range.from, range.to, setLicenseBlocked]);

  useEffect(() => { load(); }, [load]);

  const saveMovement = async () => {
    if (!movementForm) return;
    const amount = parseFloat(movementForm.amount);
    if (!amount || amount <= 0) { setMovementError('El monto debe ser mayor a cero'); return; }
    if (!movementForm.reason.trim()) { setMovementError('Debe indicar el motivo'); return; }
    setSavingMovement(true);
    setMovementError('');
    try {
      await apiFetch('/cash-sessions/movements', tenantId, {
        method: 'POST',
        body: JSON.stringify({ type: movementForm.type, amount, reason: movementForm.reason.trim() }),
      });
      setMovementForm(null);
      await load();
    } catch (err) {
      setMovementError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento');
    } finally {
      setSavingMovement(false);
    }
  };

  const exportPdf = () => {
    const movementRows = (summary?.movements ?? []).map((m) => `
      <tr>
        <td>${formatDateTime(m.createdAt)}</td>
        <td>${m.type === 'INFLOW' ? 'Ingreso' : 'Retiro'}</td>
        <td>${escapeHtml(m.reason)}</td>
        <td>${escapeHtml(m.cashSession?.user?.name ?? '—')}</td>
        <td class="num">${formatCurrency(m.amount)}</td>
      </tr>`).join('');

    printDocument('Reporte de Turnos', `
      <div class="header"><div><h1>Reporte de Turnos & Caja</h1><p class="muted">${range.from} → ${range.to}</p></div></div>
      <div class="kpis">
        <div class="kpi"><div class="label">Ingresos del periodo</div><div class="value">${formatCurrency(summary?.periodIncome ?? 0)}</div></div>
        <div class="kpi"><div class="label">Gastos / retiros</div><div class="value">${formatCurrency(summary?.periodExpenses ?? 0)}</div></div>
        <div class="kpi"><div class="label">Diferencia neta</div><div class="value">${formatCurrency(summary?.netDifference ?? 0)}</div></div>
      </div>
      <h2>Movimientos de efectivo</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Motivo</th><th>Cajero</th><th class="num">Monto</th></tr></thead>
        <tbody>${movementRows || '<tr><td colspan="5" class="muted">Sin movimientos en el periodo.</td></tr>'}</tbody>
      </table>
    `);
  };

  return (
    <AdminShell
      title="Turnos & Caja"
      subtitle="Control de flujo de efectivo por turno"
      actions={
        <>
          <button onClick={exportPdf} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">⬇ Exportar a PDF</button>
          <button onClick={load} disabled={loading} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            {loading ? 'Cargando…' : '↻ Actualizar'}
          </button>
        </>
      }
    >
      {/* ── LIVE SHIFT ── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Turno en Curso</h3>
          {live && (
            <div className="flex gap-2">
              <button onClick={() => { setMovementError(''); setMovementForm({ type: 'INFLOW', amount: '', reason: '' }); }}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100">+ Ingreso</button>
              <button onClick={() => { setMovementError(''); setMovementForm({ type: 'OUTFLOW', amount: '', reason: '' }); }}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">− Retiro</button>
            </div>
          )}
        </div>

        {!live ? (
          <Card>
            <div className="py-10 text-center">
              <p className="text-4xl">🔒</p>
              <p className="mt-3 font-semibold text-slate-700">No hay ninguna caja abierta</p>
              <p className="text-sm text-slate-500">El cajero debe realizar la Apertura de Caja desde el POS.</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Cajero: {live.cashier?.name ?? '—'}</p>
                  <p className="text-xs text-slate-400">Abierto: {formatDateTime(live.openedAt)}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Activo
                </span>
              </div>
              <BreakdownRow label="Base Inicial" value={live.openingBalance} />
              <BreakdownRow label="Ventas en Efectivo" value={live.cashSales} accent="text-emerald-600" />
              <BreakdownRow label="Ventas por Tarjeta" value={live.cardSales} accent="text-slate-500" />
              <BreakdownRow label="Ventas por Transferencia" value={live.transferSales} accent="text-slate-500" />
              <BreakdownRow label="Devolución de Dinero (anulaciones)" value={-live.cashRefunds} accent="text-red-600" />
              <BreakdownRow label="Ingresos en Efectivo (extra)" value={live.extraInflows} accent="text-emerald-600" />
              <BreakdownRow label="Retiros de Efectivo" value={-live.withdrawals} accent="text-red-600" />
              <BreakdownRow label="Total de Movimientos en Turno" value={live.totalMovements} accent="text-indigo-600" />
              <BreakdownRow label="Dinero Esperado en Caja" value={live.expectedCash} accent="text-indigo-700" strong />
              <p className="mt-3 text-xs text-slate-400">
                Fórmula: Base + Ventas efectivo + Ingresos − Retiros − Devoluciones.
                Las ventas por tarjeta/transferencia no afectan el efectivo esperado.
              </p>
            </Card>

            <Card>
              <h4 className="mb-3 text-sm font-bold text-slate-700">Movimientos del turno</h4>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {live.movements.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">Sin movimientos registrados.</p>
                ) : live.movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{m.reason}</p>
                      <p className="text-xs text-slate-400">{formatDateTime(m.createdAt)}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${m.type === 'INFLOW' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {m.type === 'INFLOW' ? '+' : '−'}{formatCurrency(m.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* ── PERIOD SUMMARY ── */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">Resumen por Periodo</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
              {PERIODS.map((p) => (
                <button key={p.value} onClick={() => setPeriod(p.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    period === p.value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}>{p.label}</button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400" />
                <span className="text-slate-400">→</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400" />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Ingresos del Periodo" value={formatCurrency(summary?.periodIncome ?? 0)} accent="text-emerald-600" icon="⬆" />
          <MetricCard label="Gastos / Retiros del Periodo" value={formatCurrency(summary?.periodExpenses ?? 0)} accent="text-red-600" icon="⬇" />
          <MetricCard label="Diferencia Neta"
            value={formatCurrency(summary?.netDifference ?? 0)}
            accent={(summary?.netDifference ?? 0) >= 0 ? 'text-indigo-600' : 'text-red-600'} icon="Σ" />
        </div>

        {/* Sessions table */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-3">
            <h4 className="text-sm font-bold text-slate-700">Turnos en el periodo</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 text-left font-semibold">Cajero</th>
                  <th className="px-4 py-3 text-left font-semibold">Apertura</th>
                  <th className="px-4 py-3 text-left font-semibold">Cierre</th>
                  <th className="px-4 py-3 text-right font-semibold">Base</th>
                  <th className="px-4 py-3 text-right font-semibold">Esperado</th>
                  <th className="px-4 py-3 text-right font-semibold">Contado</th>
                  <th className="px-4 py-3 text-center font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.sessions ?? []).map((s) => {
                  const variance = (s.actualClosingBalance ?? 0) - (s.expectedClosingBalance ?? 0);
                  return (
                    <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-3 font-medium text-slate-700">{s.user?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(s.openedAt)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{s.closedAt ? formatDateTime(s.closedAt) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(s.openingBalance)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.expectedClosingBalance != null ? formatCurrency(s.expectedClosingBalance) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {s.actualClosingBalance != null ? (
                          <span className={s.status === 'CLOSED' && variance !== 0 ? (variance > 0 ? 'text-amber-600' : 'text-red-600') : ''}>
                            {formatCurrency(s.actualClosingBalance)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          s.status === 'OPEN' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}>{s.status === 'OPEN' ? 'Abierto' : 'Cerrado'}</span>
                      </td>
                    </tr>
                  );
                })}
                {(summary?.sessions?.length ?? 0) === 0 && (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    {loading ? 'Cargando…' : 'No hay turnos en este periodo.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Movement modal ── */}
      {movementForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">
                {movementForm.type === 'INFLOW' ? 'Registrar Ingreso de Efectivo' : 'Registrar Retiro de Efectivo'}
              </h2>
            </div>
            <div className="space-y-4 px-6 py-5">
              {movementError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{movementError}</div>}
              <div className="flex gap-2">
                {(['INFLOW', 'OUTFLOW'] as const).map((t) => (
                  <button key={t} onClick={() => setMovementForm({ ...movementForm, type: t })}
                    className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                      movementForm.type === t
                        ? t === 'INFLOW' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-amber-400 bg-amber-50 text-amber-800'
                        : 'border-slate-200 text-slate-500'
                    }`}>{t === 'INFLOW' ? 'Ingreso' : 'Retiro'}</button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Monto (RD$)</label>
                <input type="number" step="0.01" value={movementForm.amount} autoFocus
                  onChange={(e) => setMovementForm({ ...movementForm, amount: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Motivo</label>
                <input value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                  placeholder="Ej: Pago a suplidor, cambio de billetes…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setMovementForm(null)} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={saveMovement} disabled={savingMovement} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {savingMovement ? 'Guardando…' : 'Registrar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
