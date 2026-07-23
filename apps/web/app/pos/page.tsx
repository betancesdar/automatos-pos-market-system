'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { ReceiptPrinter } from '../../components/ReceiptPrinter';
import { QuickAddProductModal } from '../../components/QuickAddProductModal';
import { OpenCashSessionModal } from '../../components/pos/OpenCashSessionModal';
import { CloseCashSessionModal } from '../../components/pos/CloseCashSessionModal';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, LicenseBlockedError } from '../../lib/api';
import {
  RECEIPT_TYPES,
  type CartLine,
  type CashSession,
  type Category,
  type PosProduct,
  type ReceiptTypeValue,
  lineTotal,
  productEmoji,
} from '../../lib/pos-types';

type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

function newCartId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ProductImage({ product }: { product: PosProduct }) {
  const [failed, setFailed] = useState(false);
  const slug = product.category?.slug;

  if (product.imageUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.imageUrl}
        alt={product.name}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400">
      <span className="text-3xl">{productEmoji(slug)}</span>
    </div>
  );
}

export default function POSPage() {
  const { user, logout, setLicenseBlocked } = useAuth();
  const router = useRouter();
  const tenantId = user?.tenantId ?? '';
  const searchRef = useRef<HTMLInputElement>(null);
  const clientRncRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<PosProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCategory, setActiveCategory] = useState('TODOS');
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [suggestedName, setSuggestedName] = useState('');

  const [receiptType, setReceiptType] = useState<ReceiptTypeValue>('VENTA_RAPIDA');
  const [applyItbis, setApplyItbis] = useState(false);
  const [clientRnc, setClientRnc] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent'>('fixed');
  const [discountInput, setDiscountInput] = useState('');
  const [discountAmount, setDiscountAmount] = useState(0);
  const [lastSale, setLastSale] = useState<{
    ncf?: string | null;
    total: number;
    totalReceived: number;
    totalChange: number;
  } | null>(null);

  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showCloseSession, setShowCloseSession] = useState(false);

  const receiptConfig = RECEIPT_TYPES.find((r) => r.value === receiptType)!;
  const subtotal = cart.reduce((s, i) => s + lineTotal(i), 0);
  const netSubtotal = Math.max(0, parseFloat((subtotal - discountAmount).toFixed(2)));
  const itbisAmount = applyItbis ? parseFloat((netSubtotal - netSubtotal / 1.18).toFixed(2)) : 0;
  const grandTotal = netSubtotal;
  const previewReceived = paymentMethod === 'CASH' ? parseFloat(cashReceived) || 0 : grandTotal;
  const previewChange = Math.max(0, previewReceived - grandTotal);

  const loadProducts = useCallback(async () => {
    if (!tenantId) return;
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams();
      if (activeCategory !== 'TODOS') params.set('categoryId', activeCategory);
      if (search.trim()) params.set('search', search.trim());
      const qs = params.toString();
      const data = await apiFetch<PosProduct[]>(
        `/catalog/products${qs ? `?${qs}` : ''}`,
        tenantId,
      );
      setProducts(data);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally {
      setLoadingProducts(false);
    }
  }, [tenantId, activeCategory, search, setLicenseBlocked]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const loadCategories = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await apiFetch<Category[]>('/categories', tenantId);
      setCategories(data);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    }
  }, [tenantId, setLicenseBlocked]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const loadCashSession = useCallback(async () => {
    if (!tenantId) return;
    setCheckingSession(true);
    try {
      const session = await apiFetch<CashSession | null>('/cash-sessions/current', tenantId);
      setCashSession(session);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally {
      setCheckingSession(false);
    }
  }, [tenantId, setLicenseBlocked]);

  useEffect(() => { loadCashSession(); }, [loadCashSession]);

  useEffect(() => {
    const cfg = RECEIPT_TYPES.find((r) => r.value === receiptType)!;
    setApplyItbis(cfg.applyItbis);
  }, [receiptType]);

  const addToCart = (product: PosProduct, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id && !i.isLoose);
      if (existing) {
        return prev.map((i) =>
          i.cartId === existing.cartId ? { ...i, quantity: i.quantity + qty } : i,
        );
      }
      return [{
        cartId: newCartId(),
        productId: product.id,
        name: product.name,
        basePrice: product.price,
        unitPrice: product.price,
        quantity: qty,
        isLoose: false,
      }, ...prev];
    });
  };

  const handleScan = async (barcode: string) => {
    if (!tenantId) return;
    try {
      const data = await apiFetch<{ product?: PosProduct; suggestion?: { name: string } }>(
        `/catalog/scan/${barcode}`, tenantId,
      );
      if (data.product) addToCart(data.product);
      else {
        setScannedBarcode(barcode);
        setSuggestedName(data.suggestion?.name || '');
        setModalOpen(true);
      }
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    }
  };

  const removeFromCart = (cartId: string) => setCart((prev) => prev.filter((i) => i.cartId !== cartId));

  const updateLine = (cartId: string, patch: Partial<Pick<CartLine, 'quantity' | 'unitPrice' | 'isLoose'>>) => {
    setCart((prev) => prev.map((i) => {
      if (i.cartId !== cartId) return i;
      const updated = { ...i, ...patch };
      if (patch.unitPrice !== undefined && patch.unitPrice !== i.basePrice) {
        updated.isLoose = true;
      }
      return updated;
    }));
  };

  const finalizeSale = async () => {
    setCheckoutError('');
    if (cart.length === 0) return;

    const received = paymentMethod === 'CASH'
      ? parseFloat(cashReceived) || 0
      : grandTotal;

    if (paymentMethod === 'CASH' && received < grandTotal) {
      setCheckoutError('El efectivo recibido es menor al total');
      return;
    }

    if (receiptConfig.needsRnc && !clientRnc.trim()) {
      setCheckoutError('RNC del cliente es obligatorio para Crédito Fiscal');
      return;
    }

    try {
      const data = await apiFetch<{
        receiptRaw?: string;
        sale: { ncf?: string | null; total: number; totalReceived: number; totalChange: number };
      }>(
        '/sales/checkout', tenantId,
        {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              isLoose: i.isLoose,
            })),
            cashReceived: received,
            ncfType: receiptType,
            applyItbis,
            clientRnc: receiptConfig.needsRnc ? clientRnc : undefined,
            paymentMethod,
            discountAmount: discountAmount > 0 ? discountAmount : undefined,
          }),
        },
      );

      if (data.receiptRaw && typeof window !== 'undefined' && (window as any).printReceipt) {
        await (window as any).printReceipt(data.receiptRaw);
      }

      setLastSale({
        ncf: data.sale.ncf,
        total: data.sale.total,
        totalReceived: data.sale.totalReceived,
        totalChange: data.sale.totalChange,
      });
      setCart([]);
      setDiscountAmount(0);
      setShowCheckout(false);
      setCashReceived('');
      setClientRnc('');
      loadProducts();
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
      else {
        const msg = err instanceof Error ? err.message : 'Error en facturación';
        setCheckoutError(msg);
        if (msg.toLowerCase().includes('caja')) loadCashSession();
      }
    }
  };

  const applyDiscount = () => {
    const val = parseFloat(discountInput) || 0;
    if (discountMode === 'percent') {
      setDiscountAmount(parseFloat((subtotal * Math.min(val, 100) / 100).toFixed(2)));
    } else {
      setDiscountAmount(Math.min(Math.max(val, 0), subtotal));
    }
    setShowDiscountModal(false);
  };

  const focusClientRnc = () => {
    setReceiptType('CREDITO_FISCAL');
    requestAnimationFrame(() => clientRncRef.current?.focus());
  };

  const focusLineQuantity = () => {
    const last = cart[cart.length - 1];
    if (!last) return;
    const id = activeLineId ?? last.cartId;
    setActiveLineId(id);
    setEditingLineId(id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcutKeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F8', 'F9', 'F10', 'F12'];
      const isShortcut = shortcutKeys.includes(e.key);
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;

      if (inField && !isShortcut) return;

      switch (e.key) {
        case 'F1': e.preventDefault(); searchRef.current?.focus(); break;
        case 'F2': e.preventDefault(); focusClientRnc(); break;
        case 'F3':
          e.preventDefault();
          setDiscountInput(discountAmount > 0 ? String(discountAmount) : '');
          setShowDiscountModal(true);
          break;
        case 'F4': e.preventDefault(); focusLineQuantity(); break;
        case 'F5': e.preventDefault(); setCart([]); setDiscountAmount(0); break;
        case 'F8': e.preventDefault(); setPaymentMethod('CASH'); setShowCheckout(true); break;
        case 'F9': e.preventDefault(); setPaymentMethod('CARD'); setShowCheckout(true); break;
        case 'F10': e.preventDefault(); setPaymentMethod('TRANSFER'); setShowCheckout(true); break;
        case 'F12': e.preventDefault(); if (cart.length) setShowCheckout(true); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, activeLineId, discountAmount]);

  if (checkingSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 font-sans text-slate-400">
        Verificando estado de caja…
      </div>
    );
  }

  if (!cashSession) {
    return (
      <OpenCashSessionModal
        tenantId={tenantId}
        cashierName={user?.name}
        onOpened={(session) => setCashSession(session)}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100 font-sans text-slate-900">
      <BarcodeScanner onScan={handleScan} />
      <ReceiptPrinter />
      <QuickAddProductModal isOpen={modalOpen} barcode={scannedBarcode} suggestedName={suggestedName}
        onClose={() => setModalOpen(false)} onSave={async (d) => {
          const p = await apiFetch<PosProduct>('/catalog/product', tenantId, { method: 'POST', body: JSON.stringify(d) });
          addToCart(p); setModalOpen(false); loadProducts();
        }} />
      <CloseCashSessionModal
        isOpen={showCloseSession}
        tenantId={tenantId}
        session={cashSession}
        onClose={() => setShowCloseSession(false)}
        onClosed={() => { setShowCloseSession(false); setCashSession(null); }}
      />

      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            <span className="text-indigo-600">Mini</span>Market POS
          </h1>
          <p className="text-xs text-slate-500">{user?.name} · Terminal de ventas</p>
        </div>
        {lastSale && (
          <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
            <p>Última venta RD$ {lastSale.total.toFixed(2)}</p>
            <p className="mt-0.5 text-[11px]">
              Recibido: RD$ {lastSale.totalReceived.toFixed(2)} · Cambio: RD$ {lastSale.totalChange.toFixed(2)}
            </p>
            {lastSale.ncf && <p className="mt-0.5 font-mono text-[11px]">NCF: {lastSale.ncf}</p>}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={() => setShowCloseSession(true)} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100">
            🔒 Cerrar Caja
          </button>
          {user?.role === 'ADMIN' && (
            <button onClick={() => router.push('/admin')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">Admin</button>
          )}
          <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50">Salir</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — Product workspace */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-slate-50">
          {/* Search */}
          <div className="border-b border-slate-200 bg-white p-4">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto por código, nombre o código de barra…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-indigo-500 focus:border-indigo-400 focus:ring-2"
            />
          </div>

          {/* Category tabs (dynamic from DB) */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2">
            <button
              key="TODOS"
              onClick={() => setActiveCategory('TODOS')}
              className={`shrink-0 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                activeCategory === 'TODOS'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`shrink-0 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingProducts ? (
              <p className="py-20 text-center text-slate-400">Cargando productos…</p>
            ) : products.length === 0 ? (
              <p className="py-20 text-center text-slate-400">No hay productos en esta categoría</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={p.stock <= 0}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="aspect-square w-full overflow-hidden">
                      <ProductImage product={p} />
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 group-hover:text-indigo-700">
                        {p.name}
                      </p>
                      <p className="mt-2 text-lg font-bold tabular-nums text-indigo-600">
                        RD$ {p.price.toFixed(2)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">Stock: {p.stock}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shortcut bar */}
          <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-2">
            {[
              ['F1', 'Buscar'], ['F2', 'Cliente'], ['F3', 'Descuento'],
              ['F4', 'Cantidad'], ['F5', 'Borrar'],
            ].map(([key, label]) => (
              <span key={key} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                <kbd className="font-bold text-slate-700">{key}</kbd> — {label}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT — Cart sidebar */}
        <div className="flex w-[420px] shrink-0 flex-col bg-white shadow-xl">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Carrito de Venta</h2>
            <p className="text-xs text-slate-400">{cart.length} artículo(s)</p>
          </div>

          {/* Fiscal options */}
          <div className="space-y-3 border-b border-slate-200 px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Tipo de Comprobante / NCF</label>
              <select
                value={receiptType}
                onChange={(e) => setReceiptType(e.target.value as ReceiptTypeValue)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              >
                {RECEIPT_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={applyItbis} onChange={(e) => setApplyItbis(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600" />
              Aplicar ITBIS (18%)
            </label>

            {receiptConfig.needsRnc && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">RNC del Cliente</label>
                <input value={clientRnc} onChange={(e) => setClientRnc(e.target.value)}
                  ref={clientRncRef}
                  placeholder="9 u 11 dígitos" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              </div>
            )}
          </div>

          {/* Cart table */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">Agrega productos desde la cuadrícula</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-2 py-2 text-right">Cant.</th>
                    <th className="px-2 py-2 text-right">Precio</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr key={item.cartId}
                      onClick={() => setActiveLineId(item.cartId)}
                      className={`border-b border-slate-100 hover:bg-slate-50 ${activeLineId === item.cartId ? 'bg-indigo-50/60' : ''}`}>
                      <td className="max-w-[120px] truncate px-3 py-2 font-medium text-slate-800">
                        {item.name}
                        {item.isLoose && <span className="ml-1 text-[10px] text-amber-600">DETALLE</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editingLineId === item.cartId ? (
                          <input type="number" step="0.01" min="0.01" value={item.quantity}
                            onChange={(e) => updateLine(item.cartId, { quantity: parseFloat(e.target.value) || 0.01 })}
                            className="w-16 rounded border px-1 py-0.5 text-right text-xs" autoFocus
                            onBlur={() => setEditingLineId(null)} />
                        ) : (
                          <button onClick={() => setEditingLineId(item.cartId)} className="tabular-nums hover:text-indigo-600">
                            {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input type="number" step="0.01" min="0.01" value={item.unitPrice}
                          onChange={(e) => updateLine(item.cartId, { unitPrice: parseFloat(e.target.value) || 0.01 })}
                          className="w-20 rounded border border-transparent px-1 py-0.5 text-right text-xs hover:border-slate-200 focus:border-indigo-400" />
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums text-indigo-600">
                        {lineTotal(item).toFixed(2)}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => removeFromCart(item.cartId)} className="text-red-400 hover:text-red-600" title="Eliminar">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totals & payment */}
          <div className="border-t border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span><span className="tabular-nums">RD$ {subtotal.toFixed(2)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Descuento</span><span className="tabular-nums">− RD$ {discountAmount.toFixed(2)}</span>
                </div>
              )}
              {applyItbis && (
                <div className="flex justify-between text-slate-600">
                  <span>ITBIS (18%)</span><span className="tabular-nums">RD$ {itbisAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold text-slate-900">
                <span>TOTAL</span><span className="tabular-nums text-indigo-600">RD$ {grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2">
              {([
                ['CASH', 'F8', 'Efectivo'],
                ['CARD', 'F9', 'Tarjeta'],
                ['TRANSFER', 'F10', 'Transfer.'],
              ] as const).map(([method, key, label]) => (
                <button key={method}
                  onClick={() => { setPaymentMethod(method); setShowCheckout(true); }}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    paymentMethod === method ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}>
                  <span className="block font-bold">{key}</span>{label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowCheckout(true)}
              disabled={cart.length === 0}
              className="w-full rounded-xl bg-emerald-600 py-4 text-base font-bold text-white shadow-lg transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              F12 — FINALIZAR VENTA
            </button>
          </div>
        </div>
      </div>

      {/* Discount modal (F3) */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-bold text-slate-900">F3 — Descuento</h3>
              <p className="text-sm text-slate-500">Aplica descuento fijo o porcentual al carrito</p>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex gap-2">
                {(['fixed', 'percent'] as const).map((mode) => (
                  <button key={mode} type="button"
                    onClick={() => setDiscountMode(mode)}
                    className={`flex-1 rounded-lg border py-2 text-sm font-semibold ${
                      discountMode === mode ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'
                    }`}>
                    {mode === 'fixed' ? 'RD$ Fijo' : '% Porcentaje'}
                  </button>
                ))}
              </div>
              <input type="number" step="0.01" min="0" autoFocus value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder={discountMode === 'fixed' ? 'Ej. 50.00' : 'Ej. 10'}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xl font-bold tabular-nums outline-none focus:border-indigo-400" />
              <div className="flex gap-3">
                <button type="button" onClick={() => { setDiscountAmount(0); setShowDiscountModal(false); }}
                  className="flex-1 rounded-xl border border-slate-200 py-3 font-medium">Quitar</button>
                <button type="button" onClick={applyDiscount}
                  className="flex-1 rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-500">Aplicar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Checkout modal */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="rounded-t-2xl bg-emerald-600 px-6 py-4">
              <h3 className="text-xl font-bold text-white">Confirmar Venta</h3>
              <p className="text-3xl font-black tabular-nums text-white">RD$ {grandTotal.toFixed(2)}</p>
            </div>
            <div className="space-y-4 p-6">
              {checkoutError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{checkoutError}</div>
              )}
              <p className="text-sm text-slate-600">
                Método: <strong>{paymentMethod === 'CASH' ? 'Efectivo' : paymentMethod === 'CARD' ? 'Tarjeta' : 'Transferencia'}</strong>
                {' · '}{receiptConfig.label}
              </p>
              {paymentMethod === 'CASH' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Efectivo recibido</label>
                  <input type="number" step="0.01" autoFocus value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    className="w-full rounded-xl border-2 border-emerald-300 px-4 py-3 text-2xl font-bold tabular-nums outline-none focus:border-emerald-500" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Recibido</p>
                  <p className="mt-1 font-bold tabular-nums text-slate-800">RD$ {previewReceived.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cambio / Devuelto</p>
                  <p className="mt-1 font-bold tabular-nums text-emerald-600">RD$ {previewChange.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCheckout(false)} className="flex-1 rounded-xl border border-slate-200 py-3 font-medium">
                  Cancelar
                </button>
                <button onClick={finalizeSale} className="flex-1 rounded-xl bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500">
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
