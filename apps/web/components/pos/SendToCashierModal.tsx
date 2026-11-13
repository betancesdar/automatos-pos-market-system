'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import type { CartLine, PendingOrder, ReceiptTypeValue } from '../../lib/pos-types';

interface Props {
  isOpen: boolean;
  tenantId: string;
  cart: CartLine[];
  total: number;
  ncfType: ReceiptTypeValue;
  clientRnc?: string;
  onClose: () => void;
  /** Order created successfully → page clears the cart. */
  onSent: (order: PendingOrder) => void;
}

/**
 * Biller flow: no printed ticket — the biller tells the client their short
 * code (and optionally takes their name so the cashier can also find them
 * by name in the live queue).
 */
export function SendToCashierModal({
  isOpen,
  tenantId,
  cart,
  total,
  ncfType,
  clientRnc,
  onClose,
  onSent,
}: Props) {
  const [clientName, setClientName] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentOrder, setSentOrder] = useState<PendingOrder | null>(null);

  if (!isOpen) return null;

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const order = await apiFetch<PendingOrder>('/orders', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            isLoose: i.isLoose,
          })),
          clientName: clientName.trim() || undefined,
          clientRnc: clientRnc?.trim() || undefined,
          ncfType,
          notes: notes.trim() || undefined,
        }),
      });
      setSentOrder(order);
      onSent(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al enviar el pedido');
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setSentOrder(null);
    setClientName('');
    setNotes('');
    setError('');
    onClose();
  };

  // ── Confirmation screen: big code the biller reads to the client ──
  if (sentOrder) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white text-center shadow-2xl">
          <div className="rounded-t-2xl bg-indigo-600 px-6 py-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-indigo-200">
              Pedido enviado a caja
            </p>
            <p className="mt-2 text-7xl font-black tabular-nums text-white">
              #{String(sentOrder.dailyCode).padStart(3, '0')}
            </p>
            {sentOrder.clientName && (
              <p className="mt-2 text-lg font-bold text-indigo-100">{sentOrder.clientName}</p>
            )}
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              Dile al cliente que pase a <strong>CAJA</strong> con este número
              {sentOrder.clientName ? ' o con su nombre' : ''}.
            </p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">
              Total: RD$ {sentOrder.subtotal.toFixed(2)}
            </p>
            <button
              onClick={reset}
              autoFocus
              className="w-full rounded-xl bg-indigo-600 py-4 text-base font-bold text-white hover:bg-indigo-500"
            >
              Nuevo pedido (Enter)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="rounded-t-2xl bg-indigo-600 px-6 py-4">
          <h3 className="text-xl font-bold text-white">Enviar a Caja</h3>
          <p className="text-2xl font-black tabular-nums text-white">RD$ {total.toFixed(2)}</p>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Nombre del cliente <span className="text-slate-400">(opcional, ayuda en caja)</span>
            </label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              autoFocus
              placeholder="Ej. Juan Pérez"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-indigo-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !sending && cart.length > 0) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Nota <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. pagará con tarjeta"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={reset}
              className="flex-1 rounded-xl border border-slate-200 py-3 font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={send}
              disabled={sending || cart.length === 0}
              className="flex-1 rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {sending ? 'Enviando…' : 'Enviar a Caja'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
