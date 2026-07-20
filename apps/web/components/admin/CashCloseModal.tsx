'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';

interface CashCloseModalProps {
  isOpen: boolean;
  tenantId: string;
  expectedCash?: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function CashCloseModal({ isOpen, tenantId, expectedCash, onClose, onSuccess }: CashCloseModalProps) {
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; status: string } | null>(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const data = await apiFetch<{
        message: string;
        status: string;
        receiptRaw?: string;
        discrepancy: number;
      }>('/finance/cash-drawer/close', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          countedCash: parseFloat(countedCash),
          notes: notes || undefined,
        }),
      });

      setResult({ message: data.message, status: data.status });

      if (data.receiptRaw && typeof window !== 'undefined' && (window as any).printReceipt) {
        await (window as any).printReceipt(data.receiptRaw);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cerrar caja');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Realizar Cierre de Caja</h2>
          {expectedCash != null && (
            <p className="mt-1 text-sm text-slate-500">
              Efectivo esperado hoy: RD$ {expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>

        {result ? (
          <div className="px-6 py-8 text-center">
            <p className={`text-lg font-bold ${
              result.status === 'BALANCED' ? 'text-emerald-600' :
              result.status === 'SOBRANTE' ? 'text-amber-600' : 'text-red-600'
            }`}>
              {result.status}
            </p>
            <p className="mt-2 text-slate-600">{result.message}</p>
            <button
              onClick={() => { setResult(null); onClose(); }}
              className="mt-6 rounded-lg bg-indigo-600 px-6 py-2 font-semibold text-white"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Efectivo contado físicamente (RD$)
              </label>
              <input
                type="number"
                step="0.01"
                autoFocus
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-2xl font-bold tabular-nums outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Notas (opcional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {submitting ? 'Procesando…' : 'Confirmar Cierre'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
