'use client';

import { useState, useEffect } from 'react';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { ReceiptPrinter } from '../../components/ReceiptPrinter';
import { QuickAddProductModal } from '../../components/QuickAddProductModal';

// Replace with the real seeded tenantId after running seed
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || 'REPLACE_WITH_SEEDED_TENANT_ID';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export default function POSPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [suggestedName, setSuggestedName] = useState('');
  
  // Checkout state
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [ncfType, setNcfType] = useState('CONSUMIDOR_FINAL');
  const [clientRnc, setClientRnc] = useState('');

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleScan = async (barcode: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/catalog/scan/${barcode}?tenantId=${TENANT_ID}`);
      const data = await res.json();

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

  const addToCart = (product: any) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [{ productId: product.id, name: product.name, price: product.price, quantity: 1 }, ...prev];
    });
  };

  const handleSaveNewProduct = async (productData: any) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/catalog/product?tenantId=${TENANT_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
      const newProduct = await res.json();
      addToCart(newProduct);
      setModalOpen(false);
    } catch (err) {
      console.error('Error saving product', err);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        items: cart.map(i => ({ productId: i.productId, quantity: i.quantity })),
        cashReceived: parseFloat(cashReceived),
        ncfType,
        clientRnc: ncfType === 'CREDITO_FISCAL' ? clientRnc : undefined
      };

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/sales/checkout?tenantId=${TENANT_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (data.receiptRaw) {
        if (typeof window !== 'undefined' && (window as any).printReceipt) {
          await (window as any).printReceipt(data.receiptRaw);
        }
      }
      
      setCart([]);
      setIsCheckingOut(false);
      setCashReceived('');
      setClientRnc('');
    } catch (err) {
      console.error('Checkout error', err);
      alert('Error en facturación. Revisa que el monto recibido sea suficiente.');
    }
  };

  // Global Keyboard Shortcuts
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
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans">
      <BarcodeScanner onScan={handleScan} />
      <ReceiptPrinter />
      
      <QuickAddProductModal 
        isOpen={modalOpen} 
        barcode={scannedBarcode} 
        suggestedName={suggestedName} 
        onClose={() => setModalOpen(false)} 
        onSave={handleSaveNewProduct} 
      />

      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center shadow-md">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">MiniMarket OS</h1>
          <p className="text-slate-400 text-sm font-medium">Terminal POS (Colmado)</p>
        </div>
        <div className="text-right">
          <div className="text-slate-400 text-sm uppercase tracking-wider font-bold mb-1">Total RD$</div>
          <div className="text-5xl font-black text-emerald-400 tabular-nums tracking-tighter">
            {total.toFixed(2)}
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left: Cart Area */}
        <div className="w-2/3 border-r border-slate-800 flex flex-col">
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <svg className="w-24 h-24 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                <p className="text-xl font-medium">Escanea un código para empezar</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div key={idx} className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl flex items-center justify-between shadow-sm">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-100">{item.name}</h3>
                    <p className="text-slate-400 font-medium">RD$ {item.price.toFixed(2)} c/u</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-2xl font-black text-white tabular-nums">
                      x{item.quantity}
                    </div>
                    <div className="text-2xl font-black text-emerald-400 tabular-nums w-32 text-right">
                      {(item.price * item.quantity).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="p-4 bg-slate-900 border-t border-slate-800">
            <button 
              onClick={() => setIsCheckingOut(true)}
              disabled={cart.length === 0}
              className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:bg-slate-700 text-slate-950 font-black text-2xl rounded-xl shadow-[0_0_40px_rgba(16,185,129,0.3)] transition-all uppercase tracking-widest"
            >
              Cobrar (Espacio)
            </button>
          </div>
        </div>

        {/* Right: Checkout Modal Overlay */}
        {isCheckingOut && (
          <div className="absolute inset-0 bg-slate-950/95 z-40 flex items-center justify-center p-8 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
              <div className="bg-emerald-500 p-6 flex justify-between items-center">
                <h2 className="text-3xl font-black text-slate-950 tracking-tight uppercase">Facturación</h2>
                <div className="text-4xl font-black text-slate-950 tabular-nums">
                  RD$ {total.toFixed(2)}
                </div>
              </div>
              
              <form onSubmit={handleCheckout} className="p-8 space-y-6 flex-1">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 uppercase tracking-wider text-sm">Tipo de Comprobante (NCF)</label>
                  <select 
                    value={ncfType} 
                    onChange={(e) => setNcfType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-4 text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="CONSUMIDOR_FINAL">Consumidor Final (B02)</option>
                    <option value="CREDITO_FISCAL">Crédito Fiscal (B01)</option>
                    <option value="GUBERNAMENTAL">Gubernamental (B15)</option>
                  </select>
                </div>

                {ncfType === 'CREDITO_FISCAL' && (
                  <div>
                    <label className="block text-slate-400 font-bold mb-2 uppercase tracking-wider text-sm">RNC Cliente</label>
                    <input 
                      type="text" 
                      value={clientRnc}
                      onChange={(e) => setClientRnc(e.target.value)}
                      placeholder="Ej. 130123456"
                      className="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-4 py-4 text-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                      required
                    />
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 font-bold mb-2 uppercase tracking-wider text-sm">Efectivo Recibido (RD$)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    autoFocus
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    className="w-full bg-slate-950 border-2 border-emerald-500/50 text-white rounded-xl px-4 py-6 text-4xl font-black tabular-nums focus:ring-4 focus:ring-emerald-500 outline-none placeholder:text-slate-700"
                    placeholder="0.00"
                    required
                  />
                </div>
                
                {parseFloat(cashReceived) > total && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl flex justify-between items-center">
                    <span className="text-emerald-400 font-bold text-lg">Devuelta:</span>
                    <span className="text-emerald-400 font-black text-3xl tabular-nums">
                      RD$ {(parseFloat(cashReceived) - total).toFixed(2)}
                    </span>
                  </div>
                )}

                <div className="pt-6 flex gap-4 mt-auto">
                  <button 
                    type="button"
                    onClick={() => setIsCheckingOut(false)}
                    className="px-6 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xl transition-colors w-1/3"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-black text-2xl transition-all shadow-lg uppercase"
                  >
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
