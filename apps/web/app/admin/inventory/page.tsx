'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { apiFetch, LicenseBlockedError } from '../../../lib/api';
import { formatCurrency } from '../../../lib/format';
import { AdminShell, Card } from '../../../components/admin/AdminShell';
import type { Category } from '../../../lib/pos-types';

type ProductType = 'PRODUCT' | 'SERVICE' | 'COMBO';

interface Product {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  barcode: string | null;
  type?: ProductType;
  hasVariants?: boolean;
  uom?: string | null;
  basePrice?: number;
  taxPercentage?: number;
  taxType?: string;
  price: number;
  cost: number;
  stock: number;
  imageUrl: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string; slug: string } | null;
}

type InvTab = 'products' | 'categories';

interface ProductForm {
  id: string;
  name: string;
  description: string;
  sku: string;
  barcode: string;
  type: ProductType;
  hasVariants: boolean;
  uom: string;
  basePrice: number;
  taxPercentage: number;
  taxType: string;
  cost: number;
  stock: number;
  imageUrl: string;
  categoryId: string;
}

const emptyProduct: ProductForm = {
  id: '',
  name: '',
  description: '',
  sku: '',
  barcode: '',
  type: 'PRODUCT',
  hasVariants: false,
  uom: 'Unidad',
  basePrice: 0,
  taxPercentage: 18,
  taxType: 'ITBIS',
  cost: 0,
  stock: 0,
  imageUrl: '',
  categoryId: '',
};

const UOM_OPTIONS = ['Unidad', 'Libra', 'Kilogramo', 'Litro', 'Galón', 'Onza', 'Caja', 'Paquete', 'Servicio'];

const TAX_OPTIONS: { label: string; taxPercentage: number; taxType: string }[] = [
  { label: 'ITBIS (18%)', taxPercentage: 18, taxType: 'ITBIS' },
  { label: 'ITBIS Reducido (16%)', taxPercentage: 16, taxType: 'ITBIS' },
  { label: 'Exento (0%)', taxPercentage: 0, taxType: 'EXENTO' },
];

const TYPE_OPTIONS: { value: ProductType; label: string; icon: string }[] = [
  { value: 'PRODUCT', label: 'Producto', icon: '📦' },
  { value: 'SERVICE', label: 'Servicio', icon: '🛠️' },
  { value: 'COMBO', label: 'Combo', icon: '🎁' },
];

function computeFinalPrice(basePrice: number, taxPercentage: number): number {
  return parseFloat(((basePrice || 0) * (1 + (taxPercentage || 0) / 100)).toFixed(2));
}

export default function InventoryPage() {
  const { user, setLicenseBlocked } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [tab, setTab] = useState<InvTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Product modal
  const [productForm, setProductForm] = useState<ProductForm | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState('');

  // Category modal
  const [categoryForm, setCategoryForm] = useState<{ id: string; name: string; description: string } | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState('');

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        apiFetch<Product[]>('/catalog/products', tenantId),
        apiFetch<Category[]>('/categories', tenantId),
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch (err) {
      if (err instanceof LicenseBlockedError) setLicenseBlocked(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, setLicenseBlocked]);

  useEffect(() => { load(); }, [load]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q),
    );
  }, [products, search]);

  // ── Product handlers ──────────────────────────────────────────────
  const openNewProduct = () => {
    setProductError('');
    setProductForm({ ...emptyProduct });
  };
  const openEditProduct = (p: Product) => {
    setProductError('');
    setProductForm({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      type: p.type ?? 'PRODUCT',
      hasVariants: p.hasVariants ?? false,
      uom: p.uom ?? 'Unidad',
      basePrice: p.basePrice ?? 0,
      taxPercentage: p.taxPercentage ?? 18,
      taxType: p.taxType ?? 'ITBIS',
      cost: p.cost,
      stock: p.stock,
      imageUrl: p.imageUrl ?? '',
      categoryId: p.categoryId ?? p.category?.id ?? '',
    });
  };

  const saveProduct = async () => {
    if (!productForm) return;
    if (!productForm.name.trim()) { setProductError('El nombre es obligatorio'); return; }
    if (productForm.basePrice <= 0) { setProductError('El precio base debe ser mayor a 0'); return; }
    setSavingProduct(true);
    setProductError('');
    try {
      const body = JSON.stringify({
        name: productForm.name,
        description: productForm.description || undefined,
        sku: productForm.sku || undefined,
        barcode: productForm.barcode || undefined,
        type: productForm.type,
        hasVariants: productForm.hasVariants,
        uom: productForm.uom || undefined,
        basePrice: productForm.basePrice,
        taxPercentage: productForm.taxPercentage,
        taxType: productForm.taxType,
        cost: productForm.cost,
        stock: productForm.stock,
        categoryId: productForm.categoryId || undefined,
        imageUrl: productForm.imageUrl || undefined,
      });
      if (productForm.id) {
        await apiFetch(`/catalog/product/${productForm.id}`, tenantId, { method: 'PUT', body });
      } else {
        await apiFetch('/catalog/product', tenantId, { method: 'POST', body });
      }
      setProductForm(null);
      await load();
    } catch (err) {
      setProductError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingProduct(false);
    }
  };

  const deleteProduct = async (p: Product) => {
    if (!confirm(`¿Eliminar "${p.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await apiFetch(`/catalog/product/${p.id}`, tenantId, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  // ── Category handlers ─────────────────────────────────────────────
  const saveCategory = async () => {
    if (!categoryForm) return;
    if (!categoryForm.name.trim()) { setCategoryError('El nombre es obligatorio'); return; }
    setSavingCategory(true);
    setCategoryError('');
    try {
      const body = JSON.stringify({ name: categoryForm.name, description: categoryForm.description });
      if (categoryForm.id) {
        await apiFetch(`/categories/${categoryForm.id}`, tenantId, { method: 'PUT', body });
      } else {
        await apiFetch('/categories', tenantId, { method: 'POST', body });
      }
      setCategoryForm(null);
      await load();
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingCategory(false);
    }
  };

  const deleteCategory = async (cat: Category) => {
    const count = cat._count?.products ?? 0;
    const msg = count > 0
      ? `La categoría "${cat.name}" tiene ${count} producto(s). Al eliminarla, esos productos quedarán sin categoría. ¿Continuar?`
      : `¿Eliminar la categoría "${cat.name}"?`;
    if (!confirm(msg)) return;
    try {
      await apiFetch(`/categories/${cat.id}`, tenantId, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  return (
    <AdminShell
      title="Inventario"
      subtitle={`${products.length} productos · ${categories.length} categorías`}
      actions={
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : '↻ Actualizar'}
        </button>
      }
    >
      {/* Tab switch */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-fit">
        {([['products', '📦 Productos'], ['categories', '🏷️ Categorías']] as [InvTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={openNewProduct}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              + Agregar Producto
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-6 py-3 text-left font-semibold">Producto</th>
                    <th className="px-4 py-3 text-left font-semibold">Código</th>
                    <th className="px-4 py-3 text-left font-semibold">Categoría</th>
                    <th className="px-4 py-3 text-right font-semibold">Costo</th>
                    <th className="px-4 py-3 text-right font-semibold">Precio</th>
                    <th className="px-4 py-3 text-right font-semibold">Stock</th>
                    <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-slate-400">📦</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800">{p.name}</span>
                              {p.type && p.type !== 'PRODUCT' && (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-600">
                                  {p.type === 'SERVICE' ? 'Servicio' : 'Combo'}
                                </span>
                              )}
                            </div>
                            {p.sku && <span className="font-mono text-[11px] text-slate-400">{p.sku}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.barcode || '—'}</td>
                      <td className="px-4 py-3">
                        {p.category ? (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{p.category.name}</span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(p.cost)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatCurrency(p.price)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={p.stock <= 10 ? 'font-bold text-red-600' : 'text-slate-700'}>{p.stock}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => openEditProduct(p)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">Editar</button>
                          <button onClick={() => deleteProduct(p)} className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-16 text-center text-slate-400">
                      {loading ? 'Cargando…' : 'No hay productos que coincidan.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tab === 'categories' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Gestiona las categorías que agrupan tus productos en el POS.</p>
            <button
              onClick={() => { setCategoryError(''); setCategoryForm({ id: '', name: '', description: '' }); }}
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              + Nueva Categoría
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <Card key={cat.id} className="flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between">
                    <h3 className="font-bold text-slate-800">{cat.name}</h3>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-600">
                      {cat._count?.products ?? 0} prod.
                    </span>
                  </div>
                  {cat.description && <p className="mt-1 text-sm text-slate-500">{cat.description}</p>}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => { setCategoryError(''); setCategoryForm({ id: cat.id, name: cat.name, description: cat.description ?? '' }); }}
                    className="flex-1 rounded-md border border-slate-200 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >Editar</button>
                  <button
                    onClick={() => deleteCategory(cat)}
                    className="flex-1 rounded-md border border-red-200 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >Eliminar</button>
                </div>
              </Card>
            ))}
            {categories.length === 0 && (
              <p className="col-span-full py-12 text-center text-slate-400">
                {loading ? 'Cargando…' : 'No hay categorías. Crea la primera.'}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ── Premium Product modal (image_2 layout) ── */}
      {productForm && (
        <ProductFormModal
          form={productForm}
          setForm={setProductForm}
          categories={categories}
          error={productError}
          saving={savingProduct}
          onCancel={() => setProductForm(null)}
          onSave={saveProduct}
        />
      )}

      {/* ── Category modal ── */}
      {categoryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">{categoryForm.id ? 'Editar Categoría' : 'Nueva Categoría'}</h2>
            </div>
            <div className="space-y-4 px-6 py-5">
              {categoryError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{categoryError}</div>}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
                <input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Descripción (opcional)</label>
                <textarea value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setCategoryForm(null)} className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={saveCategory} disabled={savingCategory} className="flex-1 rounded-lg bg-indigo-600 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {savingCategory ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Premium Product form modal — three-column fintech layout (image_2.png)
// ─────────────────────────────────────────────────────────────────────────────
const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100';
const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500';

function ProductFormModal({
  form,
  setForm,
  categories,
  error,
  saving,
  onCancel,
  onSave,
}: {
  form: ProductForm;
  setForm: (f: ProductForm) => void;
  categories: Category[];
  error: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const finalPrice = computeFinalPrice(form.basePrice, form.taxPercentage);
  const margin = form.cost > 0 ? ((finalPrice - form.cost) / finalPrice) * 100 : 0;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, imageUrl: reader.result as string });
    reader.readAsDataURL(file);
  };

  const selectedTaxIdx = TAX_OPTIONS.findIndex(
    (t) => t.taxPercentage === form.taxPercentage && t.taxType === form.taxType,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {form.id ? 'Editar Producto' : 'Nuevo Producto'}
            </h2>
            <p className="text-xs text-slate-500">Modelo de producto premium · precios, impuestos y variantes</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">✕</button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto bg-slate-50 p-6 lg:grid-cols-3">
          {/* LEFT — General info (2 cols) */}
          <div className="space-y-5 lg:col-span-2">
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {/* Type + variants */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <span className={labelCls + ' mb-0'}>Tipo de artículo</span>
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">¿Tiene variantes?</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, hasVariants: !form.hasVariants })}
                    className={`relative h-6 w-11 rounded-full transition-colors ${form.hasVariants ? 'bg-indigo-600' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.hasVariants ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {TYPE_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm({ ...form, type: t.value })}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-3 text-sm font-medium transition ${
                      form.type === t.value
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xl">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Identity */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Nombre del producto *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Refresco Imperio Rojo 500ml" className={inputCls} autoFocus />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Unidad de medida</label>
                    <select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} className={inputCls}>
                      {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Categoría</label>
                    <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={inputCls}>
                      <option value="">Sin categoría</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>SKU</label>
                    <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="Auto" className={inputCls + ' font-mono'} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Código de barras (referencia)</label>
                  <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="7460000000000" className={inputCls + ' font-mono'} />
                </div>
              </div>
            </div>

            {/* Pricing */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-slate-800">Precios e Impuestos</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Precio base (sin impuesto)</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">RD$</span>
                    <input type="number" step="0.01" min="0" value={form.basePrice}
                      onChange={(e) => setForm({ ...form, basePrice: parseFloat(e.target.value) || 0 })}
                      className={inputCls + ' pl-12'} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Impuesto</label>
                  <select
                    value={selectedTaxIdx === -1 ? 0 : selectedTaxIdx}
                    onChange={(e) => {
                      const t = TAX_OPTIONS[parseInt(e.target.value, 10)];
                      if (t) setForm({ ...form, taxPercentage: t.taxPercentage, taxType: t.taxType });
                    }}
                    className={inputCls}
                  >
                    {TAX_OPTIONS.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Precio final de venta (derivado)</label>
                  <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <span className="text-xs font-medium text-emerald-700">
                      Base + {form.taxType} {form.taxPercentage}%
                    </span>
                    <span className="text-xl font-bold tabular-nums text-emerald-700">{formatCurrency(finalPrice)}</span>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Costo</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">RD$</span>
                    <input type="number" step="0.01" min="0" value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })}
                      className={inputCls + ' pl-12'} />
                  </div>
                  {form.cost > 0 && (
                    <p className="mt-1 text-xs text-slate-400">Margen: <span className={margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>{margin.toFixed(1)}%</span></p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>{form.type === 'SERVICE' ? 'Disponibilidad' : 'Stock'}</label>
                  <input type="number" min="0" value={form.stock} disabled={form.type === 'SERVICE'}
                    onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
                    className={inputCls + (form.type === 'SERVICE' ? ' opacity-50' : '')} />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className={labelCls}>Descripción</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                placeholder="Detalles, presentación, notas internas…" className={inputCls} />
            </div>
          </div>

          {/* RIGHT — Preview */}
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className={labelCls}>Imagen del producto</span>
              <div className="mt-1 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50">
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="preview" className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="text-center text-slate-400">
                    <p className="text-4xl">🖼️</p>
                    <p className="mt-1 text-xs">Sin imagen</p>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-2">
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  Subir imagen
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
                <input type="url" placeholder="o pega una URL…" value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} className={inputCls + ' text-xs'} />
              </div>
            </div>

            {/* Live preview card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className={labelCls}>Vista previa (POS)</span>
              <div className="mt-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                  {form.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.imageUrl} alt="preview" className="h-full w-full object-cover" />
                  ) : <span className="text-3xl">📦</span>}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800">{form.name || 'Nombre del producto'}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-indigo-600">{formatCurrency(finalPrice)}</p>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono">{form.sku || 'SKU auto'}</span>
                    <span>{form.uom}</span>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Referencia: {form.barcode || form.sku || '—'}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <button onClick={onCancel} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={onSave} disabled={saving}
            className="rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50">
            {saving ? 'Guardando…' : form.id ? 'Guardar Cambios' : 'Crear Producto'}
          </button>
        </div>
      </div>
    </div>
  );
}
