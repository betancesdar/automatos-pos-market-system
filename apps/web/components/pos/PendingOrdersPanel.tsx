'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../lib/api';
import type { PendingOrder } from '../../lib/pos-types';

interface Props {
  tenantId: string;
  activeOrderId: string | null;
  /** Cashier picked an order → page loads its items into the cart. */
  onSelect: (order: PendingOrder) => void;
  onClearActive: () => void;
}

/**
 * Live queue for the central cashier in BILLER_CASHIER mode: billers create
 * pending orders at their stations, the client walks to the register with a
 * short code ("#042") or their name, and the cashier picks the order here.
 * Polls every 4s — cheap query over the (tenantId, status) index.
 */
export function PendingOrdersPanel({ tenantId, activeOrderId, onSelect, onClearActive }: Props) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<PendingOrder[]>('/orders?status=PENDING', tenantId);
      setOrders(data);
    } catch {
      // Polling failure is non-fatal (offline blip) — keep the last list.
    }
  }, [tenantId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const findByCode = async () => {
    const code = parseInt(codeInput.replace(/\D/g, ''), 10);
    if (!code) return;
    setError('');
    try {
      const order = await apiFetch<PendingOrder>(`/orders/by-code/${code}`, tenantId);
      if (order.status !== 'PENDING') {
        setError(`El pedido #${code} ya fue ${order.status === 'COMPLETED' ? 'cobrado' : 'cancelado'}`);
        return;
      }
      setCodeInput('');
      onSelect(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : `No se encontró el pedido #${code}`);
    }
  };

  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="border-b border-indigo-200 bg-indigo-50/70">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-sm font-bold text-indigo-800"
        >
          <span>{collapsed ? '▸' : '▾'}</span>
          🧾 Pedidos en espera de cobro
          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
            {orders.length}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {activeOrderId && (
            <button
              onClick={onClearActive}
              className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              ✕ Soltar pedido cargado
            </button>
          )}
          <input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                findByCode();
              }
            }}
            placeholder="# código"
            inputMode="numeric"
            className="w-24 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-sm font-bold tabular-nums outline-none focus:border-indigo-400"
          />
          <button
            onClick={findByCode}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500"
          >
            Buscar
          </button>
        </div>
      </div>

      {error && (
        <p className="px-4 pb-2 text-xs font-semibold text-red-600">{error}</p>
      )}

      {!collapsed && orders.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-3">
          {orders.map((order) => (
            <button
              key={order.id}
              onClick={() => onSelect(order)}
              className={`flex shrink-0 flex-col items-start rounded-xl border px-3 py-2 text-left shadow-sm transition-colors ${
                activeOrderId === order.id
                  ? 'border-indigo-500 bg-indigo-600 text-white'
                  : 'border-indigo-200 bg-white hover:border-indigo-400'
              }`}
            >
              <span className={`text-lg font-black tabular-nums ${activeOrderId === order.id ? 'text-white' : 'text-indigo-700'}`}>
                #{String(order.dailyCode).padStart(3, '0')}
              </span>
              <span className={`max-w-[140px] truncate text-xs font-semibold ${activeOrderId === order.id ? 'text-indigo-100' : 'text-slate-700'}`}>
                {order.clientName || 'Sin nombre'}
              </span>
              <span className={`text-[11px] ${activeOrderId === order.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                {order.creator?.name ?? ''} · {timeOf(order.createdAt)}
              </span>
              <span className={`mt-0.5 text-xs font-bold tabular-nums ${activeOrderId === order.id ? 'text-white' : 'text-emerald-600'}`}>
                RD$ {order.subtotal.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      )}

      {!collapsed && orders.length === 0 && (
        <p className="px-4 pb-3 text-xs text-indigo-400">
          No hay pedidos pendientes — los facturadores aún no han enviado ninguno.
        </p>
      )}
    </div>
  );
}
