'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface TenantReceiptData {
  id: string;
  name: string;
  commercialName: string | null;
  address: string | null;
  phone: string | null;
  receiptLogoUrl: string | null;
  receiptFooter: string | null;
  paperSize: string;
}

const PAPER_SIZES = [
  { value: '80mm', label: '80mm (estándar, 32 caracteres)' },
  { value: '58mm', label: '58mm (compacta, 24 caracteres)' },
];

export function ReceiptSettingsPanel({ tenantId }: { tenantId: string }) {
  const [commercialName, setCommercialName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [receiptLogoUrl, setReceiptLogoUrl] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [paperSize, setPaperSize] = useState('80mm');
  const [businessName, setBusinessName] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    apiFetch<TenantReceiptData>('/tenant', tenantId)
      .then((data) => {
        setBusinessName(data.name);
        setCommercialName(data.commercialName || '');
        setAddress(data.address || '');
        setPhone(data.phone || '');
        setReceiptLogoUrl(data.receiptLogoUrl || '');
        setReceiptFooter(data.receiptFooter || '');
        setPaperSize(data.paperSize || '80mm');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReceiptLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await apiFetch('/tenant', tenantId, {
        method: 'PUT',
        body: JSON.stringify({
          commercialName: commercialName || null,
          address,
          phone,
          receiptLogoUrl: receiptLogoUrl || null,
          receiptFooter: receiptFooter || null,
          paperSize,
        }),
      });
      setMessage('Configuración de recibo guardada correctamente');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-slate-500">Cargando configuración…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={handleSave} className="space-y-6 lg:col-span-2">
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-bold text-slate-900">Identidad del Recibo</h3>
          <div className="grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre Comercial (encabezado del recibo)</label>
              <input value={commercialName} onChange={(e) => setCommercialName(e.target.value)} placeholder={businessName}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              <p className="mt-1 text-xs text-slate-400">Si se deja vacío, se usará el nombre legal del negocio: {businessName}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Dirección</label>
                <input value={address} onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-bold text-slate-900">Logo del Negocio</h3>
          <div className="grid gap-3">
            <input type="url" placeholder="https://…" value={receiptLogoUrl.startsWith('data:') ? '' : receiptLogoUrl}
              onChange={(e) => setReceiptLogoUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
            <input type="file" accept="image/*" onChange={handleLogoFile}
              className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700" />
            {receiptLogoUrl && (
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptLogoUrl} alt="Logo" className="h-full w-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <p className="text-xs text-slate-400">
              Se muestra en el panel y facturas digitales. Las impresoras térmicas ESC/POS imprimen el nombre comercial
              en texto; el logo gráfico requiere una impresora con soporte de imágenes raster.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-bold text-slate-900">Pie de Página y Papel</h3>
          <div className="grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Política / Mensaje de Pie de Página</label>
              <textarea value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} rows={3}
                placeholder="GRACIAS POR SU COMPRA — No se aceptan devoluciones sin recibo"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tamaño de Papel Térmico</label>
              <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500">
                {PAPER_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="rounded-lg bg-indigo-600 px-6 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar Configuración de Recibo'}
        </button>
      </form>

      {/* Live preview */}
      <div className="lg:col-span-1">
        <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Vista Previa</h3>
          <div className="mx-auto max-w-[220px] rounded-lg border border-dashed border-slate-300 bg-white p-4 font-mono text-[11px] leading-relaxed text-slate-800 shadow-inner">
            {receiptLogoUrl && (
              <div className="mb-2 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptLogoUrl} alt="Logo" className="h-10 w-10 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
            <p className="text-center font-bold">{commercialName || businessName || 'MI NEGOCIO'}</p>
            {address && <p className="text-center">{address}</p>}
            {phone && <p className="text-center">Tel: {phone}</p>}
            <p className="my-2 border-t border-dashed border-slate-300" />
            <p>NCF: B0200000001</p>
            <p>Fecha: {new Date().toLocaleDateString('es-DO')}</p>
            <p className="my-2 border-t border-dashed border-slate-300" />
            <p>1 Producto Ejemplo 150.00</p>
            <p className="my-2 border-t border-dashed border-slate-300" />
            <p className="text-center font-bold">TOTAL: RD$ 150.00</p>
            <p className="mt-3 text-center">{receiptFooter || 'GRACIAS POR SU COMPRA'}</p>
            <p className="mt-1 text-center text-[9px] text-slate-400">Papel {paperSize}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
