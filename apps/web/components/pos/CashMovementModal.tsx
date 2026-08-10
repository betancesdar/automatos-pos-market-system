'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

type MovementKind = 'RETIRO' | 'INGRESO';

/**
 * Common reasons for a manual cash movement. This temporarily replaces the
 * "Cuenta contable" (accounting-ledger) field from the reference design —
 * the full accounting module isn't built yet, so instead of linking to a
 * ledger account we just capture a short, descriptive reason + free-text
 * observation, enough for the business owner to know why money moved
 * outside of a normal product sale.
 */
const REASON_OPTIONS = [
  'Cambio de billete grande',
  'Depósito bancario',
  'Pago a proveedor',
  'Retiro de utilidades / dueño',
  'Fondeo adicional de caja',
  'Préstamo / vale a empleado',
  'Otro (especificar en observaciones)',
];

interface CashMovementModalProps {
  isOpen: boolean;
  tenantId: string;
  sessionId?: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * "Nuevo movimiento de efectivo" — lets the cashier register a manual cash
 * withdrawal (RETIRO) or deposit (INGRESO), e.g. breaking a large bill,
 * without going through a full sale.
 */
export function CashMovementModal({ isOpen, tenantId, sessionId, onClose, onSaved }: CashMovementModalProps) {
  const [kind, setKind] = useState<MovementKind>('RETIRO');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [observations, setObservations] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const resetAndClose = () => {
    setKind('RETIRO');
    setAmount('');
    setReason(REASON_OPTIONS[0]);
    setObservations('');
    setError('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = parseFloat(amount);
    if (isNaN(value) || value <= 0) {
      setError('Ingresa una cantidad de efectivo válida');
      return;
    }

    // Backend stores a single free-text `reason` — combine the picked reason
    // with the optional observation for a clear audit trail.
    const combinedReason = observations.trim() ? `${reason} — ${observations.trim()}` : reason;

    setSubmitting(true);
    try {
      await apiFetch('/cash-sessions/movements', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          type: kind === 'RETIRO' ? 'OUTFLOW' : 'INFLOW',
          amount: value,
          reason: combinedReason,
          sessionId,
        }),
      });
      resetAndClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Nuevo movimiento de efectivo</h2>
          <button type="button" onClick={resetAndClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {/* RETIRO / INGRESO toggle */}
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setKind('RETIRO')}
              className={`py-2.5 text-sm font-bold uppercase tracking-wide transition-colors ${
                kind === 'RETIRO' ? 'bg-red-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              Retiro
            </button>
            <button
              type="button"
              onClick={() => setKind('INGRESO')}
              className={`py-2.5 text-sm font-bold uppercase tracking-wide transition-colors ${
                kind === 'INGRESO' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              Ingreso
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Cantidad de efectivo <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-2xl font-bold tabular-nums outline-none focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Motivo <span className="text-red-500">*</span>
            </label>
            {/*
              Temporary stand-in for "Cuenta contable" (accounting ledger).
              The accounting module isn't built yet, so this is a simple
              reason picker rather than a real ledger-account link.
            */}
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observaciones</label>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={3}
              placeholder="Detalle adicional para que el dueño del negocio sepa por qué se movió el dinero…"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={resetAndClose} className="flex-1 rounded-xl border border-slate-200 py-3 font-medium">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
