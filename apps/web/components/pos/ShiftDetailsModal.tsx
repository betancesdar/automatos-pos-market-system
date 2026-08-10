'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface LiveShift {
  sessionId: string;
  cashier: { id: string; name: string };
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
  movements: { id: string; type: string; amount: number; reason: string; createdAt: string }[];
}

function money(n: number): string {
  return `RD$${n.toFixed(2)}`;
}

interface ShiftDetailsModalProps {
  isOpen: boolean;
  tenantId: string;
  onClose: () => void;
  onCloseShiftRequested: () => void;
  /** Bumped by the parent whenever a new cash movement is registered, to force a refresh. */
  refreshKey?: number;
}

/**
 * "Detalle del turno en curso" — read-only breakdown of the active cash
 * session, mirroring the reference layout: opening balance, sales broken
 * down by payment method, refunds, net movement total, and the
 * automatically-calculated expected cash in the drawer.
 */
export function ShiftDetailsModal({ isOpen, tenantId, onClose, onCloseShiftRequested, refreshKey }: ShiftDetailsModalProps) {
  const [shift, setShift] = useState<LiveShift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadShift = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<LiveShift | null>('/cash-sessions/live', tenantId);
      setShift(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el detalle del turno');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isOpen) loadShift();
  }, [isOpen, loadShift, refreshKey]);

  if (!isOpen) return null;

  const rows: [string, number, boolean?][] = shift
    ? [
        ['Base inicial', shift.openingBalance],
        ['Ventas en efectivo', shift.cashSales],
        ['Ventas por tarjeta (débito/crédito)', shift.cardSales],
        ['Ventas por transferencias', shift.transferSales],
        ['Ingresos de efectivo (manuales)', shift.extraInflows],
        ['Retiros de efectivo (manuales)', -shift.withdrawals],
        ['Devolución de dinero', -shift.cashRefunds, true],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Detalles del turno en curso</h2>
            <p className="text-xs text-slate-500">Conoce los movimientos de efectivo en tu turno de caja actual</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Cargando…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : !shift ? (
            <p className="py-10 text-center text-sm text-slate-400">No hay un turno abierto</p>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fecha de inicio</p>
                  <p className="text-sm font-medium text-slate-800">{new Date(shift.openedAt).toLocaleString('es-DO')}</p>
                  <p className="mt-1 text-xs text-slate-500">Cajero: {shift.cashier?.name}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">ABIERTO</span>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                {rows.map(([label, value, danger], idx) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between px-4 py-2.5 text-sm ${idx !== rows.length - 1 ? 'border-b border-slate-100' : ''}`}
                  >
                    <span className="text-slate-600">{label}</span>
                    <span className={`tabular-nums font-medium ${danger && value !== 0 ? 'text-red-600' : 'text-slate-800'}`}>
                      {value < 0 ? '- ' : ''}{money(Math.abs(value))}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-slate-50 px-4 py-3 text-sm font-bold">
                  <span className="text-slate-700">Total de movimientos del turno</span>
                  <span className="tabular-nums text-slate-900">{money(shift.totalMovements)}</span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Dinero esperado en caja</p>
                <p className="text-xs text-indigo-400">Base inicial más las ventas e ingresos en efectivo, menos las devoluciones y retiros</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-indigo-700">{money(shift.expectedCash)}</p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50">
            Cerrar
          </button>
          {shift && (
            <button
              onClick={onCloseShiftRequested}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500"
            >
              🔒 Cerrar Turno
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
