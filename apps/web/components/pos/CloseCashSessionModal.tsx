'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { CashSession } from '../../lib/pos-types';

interface CloseResult {
  variance: number;
  status: string;
  expectedClosingBalance: number;
  actualClosingBalance: number;
  openingBalance: number;
  cashSalesTotal: number;
  receiptRaw?: string;
}

interface CloseCashSessionModalProps {
  isOpen: boolean;
  tenantId: string;
  session: CashSession | null;
  onClose: () => void;
  onClosed: () => void;
}

/**
 * "Cerrar Caja" blind-count modal.
 * The cashier only enters what they physically counted — the backend computes
 * the expected amount and variance server-side (blind count).
 */
export function CloseCashSessionModal({ isOpen, tenantId, session, onClose, onClosed }: CloseCashSessionModalProps) {
  const [actualClosingBalance, setActualClosingBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CloseResult | null>(null);

  if (!isOpen || !session) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = parseFloat(actualClosingBalance);
    if (isNaN(value) || value < 0) {
      setError('Ingresa el monto contado físicamente');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiFetch<CloseResult>(`/cash-sessions/${session.id}/close`, tenantId, {
        method: 'POST',
        body: JSON.stringify({ actualClosingBalance: value }),
      });
      setResult(data);
      if (data.receiptRaw && typeof window !== 'undefined' && (window as any).printReceipt) {
        await (window as any).printReceipt(data.receiptRaw);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cerrar la caja');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    setResult(null);
    setActualClosingBalance('');
    onClosed();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="rounded-t-2xl bg-amber-600 px-6 py-5">
          <h2 className="text-xl font-bold text-white">🔒 Cerrar Caja</h2>
          <p className="mt-1 text-sm text-amber-100">Conteo a ciegas — no se muestra el monto esperado</p>
        </div>

        {result ? (
          <div className="space-y-4 px-6 py-6 text-center">
            <p className={`text-2xl font-black ${
              result.status === 'CAJA CUADRADA' ? 'text-emerald-600' :
              result.status === 'SOBRANTE' ? 'text-amber-600' : 'text-red-600'
            }`}>
              {result.status}
            </p>
            <div className="space-y-1 rounded-xl bg-slate-50 p-4 text-left text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Fondo inicial</span><span className="tabular-nums font-medium">RD$ {result.openingBalance.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Ventas en efectivo</span><span className="tabular-nums font-medium">RD$ {result.cashSalesTotal.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1"><span className="text-slate-500">Esperado en caja</span><span className="tabular-nums font-semibold">RD$ {result.expectedClosingBalance.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Contado (físico)</span><span className="tabular-nums font-semibold">RD$ {result.actualClosingBalance.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">Diferencia</span>
                <span className={`tabular-nums font-bold ${result.variance === 0 ? 'text-emerald-600' : result.variance > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                  {result.variance > 0 ? '+' : ''}RD$ {result.variance.toFixed(2)}
                </span>
              </div>
            </div>
            <button
              onClick={handleDone}
              className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500"
            >
              Continuar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Efectivo contado físicamente (RD$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={actualClosingBalance}
                onChange={(e) => setActualClosingBalance(e.target.value)}
                required
                className="w-full rounded-xl border-2 border-amber-300 px-4 py-3 text-2xl font-bold tabular-nums outline-none focus:border-amber-500"
              />
              <p className="mt-2 text-xs text-slate-400">
                Cuenta todo el efectivo físico en la caja. El sistema calculará automáticamente la diferencia.
              </p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-3 font-medium">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl bg-amber-600 py-3 font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {submitting ? 'Cerrando…' : 'Confirmar Cierre'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
