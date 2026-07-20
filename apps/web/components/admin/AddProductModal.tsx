'use client';

import { useState, useEffect } from 'react';

export interface ProductFormData {
  barcode: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  category: string;
}

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void>;
}

const emptyForm: ProductFormData = {
  barcode: '',
  name: '',
  price: 0,
  cost: 0,
  stock: 0,
  category: '',
};

export function AddProductModal({ isOpen, onClose, onSave }: AddProductModalProps) {
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(emptyForm);
      setErrors({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'El nombre es obligatorio';
    if (form.price <= 0) next.price = 'El precio debe ser mayor a 0';
    if (form.cost < 0) next.cost = 'El costo no puede ser negativo';
    if (form.stock < 0) next.stock = 'El stock no puede ser negativo';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Error al guardar' });
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof ProductFormData, label: string, type = 'text', required = false) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input
        type={type}
        step={type === 'number' ? '0.01' : undefined}
        value={form[key]}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            [key]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value,
          }))
        }
        required={required}
        className={`w-full rounded-lg border px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${
          errors[key] ? 'border-red-300' : 'border-slate-300'
        }`}
      />
      {errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Agregar Producto</h2>
          <p className="text-sm text-slate-500">Registra un nuevo artículo en el inventario</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {errors.form && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errors.form}
            </div>
          )}

          {field('name', 'Nombre del producto', 'text', true)}
          <div className="grid grid-cols-2 gap-4">
            {field('barcode', 'Código de barras')}
            {field('category', 'Categoría')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('price', 'Precio venta (RD$)', 'number', true)}
            {field('cost', 'Costo (RD$)', 'number')}
          </div>
          {field('stock', 'Stock inicial', 'number')}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? 'Guardando…' : 'Guardar Producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
