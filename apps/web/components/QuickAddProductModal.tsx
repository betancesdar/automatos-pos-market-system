'use client';

import { useState, useEffect, useRef } from 'react';

interface QuickAddModalProps {
  isOpen: boolean;
  barcode: string;
  suggestedName: string;
  onClose: () => void;
  onSave: (product: any) => void;
}

export function QuickAddProductModal({ isOpen, barcode, suggestedName, onClose, onSave }: QuickAddModalProps) {
  const [name, setName] = useState(suggestedName);
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(suggestedName);
      setPrice('');
      setCost('');
      // Focus the price input right away so they can just type the price and hit enter
      setTimeout(() => priceInputRef.current?.focus(), 100);
    }
  }, [isOpen, suggestedName]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      barcode,
      name: name || 'Producto Desconocido',
      price: parseFloat(price) || 0,
      cost: parseFloat(cost) || 0,
      stock: 1, // Default add 1 stock
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 p-4">
          <h2 className="text-2xl font-bold text-white tracking-tight">Agregar Producto Rápido</h2>
          <p className="text-blue-200 text-sm mt-1">Código: {barcode}</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-1">Nombre (Sugerido por IA)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">Precio Venta (RD$)</label>
              <input
                ref={priceInputRef}
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-3 text-xl font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-1">Costo (RD$)</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-white rounded-lg px-4 py-3 text-xl focus:ring-2 focus:ring-slate-500 outline-none"
              />
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition-colors"
            >
              Cancelar (Esc)
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-lg transition-colors shadow-lg shadow-blue-500/20"
            >
              Guardar (Enter)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
