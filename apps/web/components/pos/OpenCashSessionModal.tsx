'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { CashSession } from '../../lib/pos-types';

interface OpenCashSessionModalProps {
  tenantId: string;
  cashierName?: string;
  onOpened: (session: CashSession) => void;
}

/**
 * Unavoidable "Apertura de Caja" modal.
 * Rendered whenever the cashier does not have an OPEN cash session — blocks
 * all POS interaction until a valid opening balance (fondo inicial) is set.
 */
export function OpenCashSessionModal({ tenantId, cashierName, onOpened }: OpenCashSessionModalProps) {
  const [openingBalance, setOpeningBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = parseFloat(openingBalance);
    if (isNaN(value) || value < 0) {
      setError('Ingresa un fondo inicial válido');
      return;
    }
    setSubmitting(true);
    try {
      const session = await apiFetch<CashSession>('/cash-sessions/open', tenantId, {
        method: 'POST',
        body: JSON.stringify({ openingBalance: value }),
      });
      onOpened(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al abrir la caja');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="rounded-t-2xl bg-indigo-600 px-6 py-5">
          <h2 className="text-xl font-bold text-white">🔓 Apertura de Caja</h2>
          <p className="mt-1 text-sm text-indigo-100">
            {cashierName ? `Bienvenido/a, ${cashierName}. ` : ''}
            Debes ingresar el fondo inicial antes de comenzar a vender.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Fondo inicial de caja (RD$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              required
              className="w-full rounded-xl border-2 border-indigo-200 px-4 py-3 text-2xl font-bold tabular-nums outline-none focus:border-indigo-500"
            />
            <p className="mt-2 text-xs text-slate-400">
              Cuenta el efectivo físico presente en la caja antes de la primera venta.
            </p>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 py-3.5 text-base font-bold text-white shadow-lg hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Abriendo caja…' : 'Abrir Caja e Iniciar Ventas'}
          </button>
        </form>
      </div>
    </div>
  );
}
