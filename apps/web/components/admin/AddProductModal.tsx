'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

export interface ProductFormData {
  barcode: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  categoryId: string;
  imageUrl: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface AddProductModalProps {
  isOpen: boolean;
  tenantId: string;
  onClose: () => void;
  onSave: (data: ProductFormData) => Promise<void>;
}

const emptyForm: ProductFormData = {
  barcode: '',
  name: '',
  price: 0,
  cost: 0,
  stock: 0,
  categoryId: '',
  imageUrl: '',
};

export function AddProductModal({ isOpen, tenantId, onClose, onSave }: AddProductModalProps) {
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    if (isOpen && tenantId) {
      setForm(emptyForm);
      setErrors({});
      setImagePreview('');
      apiFetch<Category[]>('/catalog/categories', tenantId).then(setCategories).catch(console.error);
    }
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  const validate = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'El nombre es obligatorio';
    if (form.price <= 0) next.price = 'El precio debe ser mayor a 0';
    if (!form.categoryId) next.categoryId = 'Selecciona una categoría';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleImageUrl = (url: string) => {
    setForm((f) => ({ ...f, imageUrl: url }));
    setImagePreview(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      handleImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Agregar Producto</h2>
          <p className="text-sm text-slate-500">Categoría, imagen y datos de inventario</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {errors.form && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errors.form}</div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nombre del producto</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
            {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Código de barras</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Categoría</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500">
                <option value="">Seleccionar…</option>
                {categories.filter((c) => c.slug !== 'TODOS').map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.categoryId && <p className="mt-1 text-xs text-red-600">{errors.categoryId}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Precio venta (RD$)</label>
              <input type="number" step="0.01" value={form.price}
                onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Costo (RD$)</label>
              <input type="number" step="0.01" value={form.cost}
                onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Stock inicial</label>
            <input type="number" value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Imagen (URL o archivo)</label>
            <input type="url" placeholder="https://…" value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl}
              onChange={(e) => handleImageUrl(e.target.value)}
              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <input type="file" accept="image/*" onChange={handleFileChange}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700" />
            {(imagePreview || form.imageUrl) && (
              <div className="mt-3 flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview || form.imageUrl} alt="Preview" className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {submitting ? 'Guardando…' : 'Guardar Producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
