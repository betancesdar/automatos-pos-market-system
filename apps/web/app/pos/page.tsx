'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { ReceiptPrinter } from '../../components/ReceiptPrinter';
import { QuickAddProductModal } from '../../components/QuickAddProductModal';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, LicenseBlockedError } from '../../lib/api';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function POSPage() {
  const { user, logout, setLicenseBlocked } = useAuth();
  const router = useRouter();
  const tenantId = user?.tenantId ?? '';

  const [cart, setCart] = useState<CartItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [suggestedName, setSuggestedName] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [ncfType, setNcfType] = useState('CONSUMIDOR_FINAL');
  const [clientRnc, setClientRnc] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [lastSale, setLastSale] = useState<{ ncf?: string; total: number } | null>(null);

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleScan = async (barcode: string) => {
    if (!tenantId) return;
    try {
      const data = await apiFetch<{ product?: { id: string; name: string; price: number }; suggestion?: { name: string } }>(
        `/catalog/scan/${barcode}`, tenantId,
      );
      if (data.product) {
        addToCart(data.product);
      } else {
        setScannedBarcode(barcode);
        setSuggestedName(data.suggestion?.name || '');
        setModalOpen(true);
      }
    } catch (err) {
      console.error('Scan error', err);
    }
  };

  const addToCart = (product: { id: string; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [{ productId: product.id, name: product.name, price: product.price, quantity: 1 }, ...prev];
    });
  };

  const handleSaveNewProduct = async (productData: Record<string, unknown>) => {
    const newProduct = await apiFetch<{ id: string; name: string; price: number }>(
      '/catalog/product', tenantId,
      { method: 'POST', body: JSON.stringify(productData) },
    );
    addToCart(newProduct);
    setModalOpen(false);
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckoutError('');
    try {
      const data = await apiFetch<{ receiptRaw?: string; sale: { ncf?: string; total: number } }>(
        '/sales/checkout', tenantId,
        {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
            cashReceived: parseFloat(cashReceived),
            ncfType,
            clientRnc: ncfType === 'CREDITO_FISCAL' ? clientRnc : undefined,
          }),
        },
      );

      if (data.receiptRaw && typeof window !== 'undefined' && (window as any).printReceipt) {
        await (window as any).printReceipt(data.receiptRaw);
      }

      setLastSale({ ncf: data.sale.ncf, total: data.sale.total });
      setCart([]);
      setIsCheckingOut(false);
      setCashReceived('');
      setClientRnc('');
    } catch (err) {
      if (err instanceof LicenseBlockedError) {
        setLicenseBlocked(err.message);
      } else {
        setCheckoutError(err instanceof Error ? err.message : 'Error en facturación');
      }
    }
  };

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCart([]);
        setIsCheckingOut(false);
        setModalOpen(false);
      } else if (e.code === 'Space' && cart.length > 0 && !isCheckingOut && !modalOpen) {
        e.preventDefault();
        setIsCheckingOut(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [cart, isCheckingOut, modalOpen]);

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-950 font-sans">
      <BarcodeScanner onScan={handleScan} />
      <ReceiptPrinter />

      <QuickAddProductModal
        isOpen={modalOpen}
        barcode={scannedBarcode}
        suggestedName={suggestedName}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveNewProduct}
      />

      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 p-4 shadow-md">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">MiniMarket OS</h1>
          <p className="text-sm font-medium text-slate-400">
            Terminal POS · {user?.name}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lastSale && (
            <div className="text-right text-sm text-emerald-400">
              Última venta: RD$ {lastSale.total.toFixed(2)}
              {lastSale.ncf && <span className="block font-mono text-xs">{lastSale.ncf}</span>}
            </div>
          )}
          <div className="text-right">
            <div className="mb-1 text-sm font-bold uppercase tracking-wider text-slate-400">Total RD$</div>
            <div className="text-5xl font-black tabular-nums tracking-tighter text-emerald-400">
              {total.toFixed(2)}
            </div>
          </div>
          {user?.role === 'ADMIN' && (
            <button onClick={() => router.push('/admin')}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
              Admin
            </button>
          )}
          <button onClick={logout}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-700">
            Salir
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className="flex w-2/3 flex-col border-r border-slate-800">
          <div className="flex-1 space-y-2 overflow-auto p-4">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-500">
                <p className="text-xl font-medium">Escanea un código para empezar</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-100">{item.name}</h3>
                    <p className="font-medium text-slate-400">RD$ {item.price.toFixed(2)} c/u</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-2xl font-black tabular-nums text-white">x{item.quantity}</div>
                    <div className="w-32 text-right text-2xl font-black tabular-nums text-emerald-400">
                      {(item.price * item.quantity).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-slate-800 bg-slate-900 p-4">
            <button onClick={() => setIsCheckingOut(true)} disabled={cart.length === 0}
              className="w-full rounded-xl bg-emerald-500 py-5 text-2xl font-black uppercase tracking-widest text-slate-950 shadow-[0_0_40px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-400 disabled:bg-slate-700 disabled:opacity-50">
              Cobrar (Espacio)
            </button>
          </div>
        </div>

        {isCheckingOut && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/95 p-8 backdrop-blur-sm">
            <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between bg-emerald-500 p-6">
                <h2 className="text-3xl font-black uppercase tracking-tight text-slate-950">Facturación</h2>
                <div className="text-4xl font-black tabular-nums text-slate-950">RD$ {total.toFixed(2)}</div>
              </div>
              <form onSubmit={handleCheckout} className="flex flex-1 flex-col space-y-6 p-8">
                {checkoutError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-400">{checkoutError}</div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-slate-400">Tipo NCF</label>
                  <select value={ncfType} onChange={(e) => setNcfType(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-xl font-bold text-white outline-none focus:ring-2 focus:ring-emerald-500">
                    <option value="CONSUMIDOR_FINAL">Consumidor Final (B02)</option>
                    <option value="CREDITO_FISCAL">Crédito Fiscal (B01)</option>
                    <option value="GUBERNAMENTAL">Gubernamental (B15)</option>
                  </select>
                </div>
                {ncfType === 'CREDITO_FISCAL' && (
                  <div>
                    <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-slate-400">RNC Cliente</label>
                    <input type="text" value={clientRnc} onChange={(e) => setClientRnc(e.target.value)}
                      placeholder="9 u 11 dígitos" required
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-xl font-bold text-white outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                )}
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-slate-400">Efectivo Recibido</label>
                  <input type="number" step="0.01" autoFocus value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)} required
                    className="w-full rounded-xl border-2 border-emerald-500/50 bg-slate-950 px-4 py-6 text-4xl font-black tabular-nums text-white outline-none focus:ring-4 focus:ring-emerald-500" />
                </div>
                {parseFloat(cashReceived) > total && (
                  <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <span className="text-lg font-bold text-emerald-400">Devuelta:</span>
                    <span className="text-3xl font-black tabular-nums text-emerald-400">
                      RD$ {(parseFloat(cashReceived) - total).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="mt-auto flex gap-4 pt-6">
                  <button type="button" onClick={() => setIsCheckingOut(false)}
                    className="w-1/3 rounded-xl bg-slate-800 py-4 text-xl font-bold text-white hover:bg-slate-700">
                    Cancelar
                  </button>
                  <button type="submit"
                    className="flex-1 rounded-xl bg-emerald-500 py-4 text-2xl font-black uppercase text-slate-950 shadow-lg hover:bg-emerald-400">
                    Confirmar Pago
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
