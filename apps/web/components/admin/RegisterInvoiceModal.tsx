'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiUpload } from '../../lib/api';

interface SupplierOpt { id: string; name: string; rnc?: string | null }
interface ProductOpt { id: string; name: string; sku?: string | null; barcode?: string | null; cost?: number }
interface Line { rawName: string; quantity: number; unitCost: number; productId: string | null; matchedName?: string | null }

interface ImportField { value: string; label: string }
interface ParseResult {
  source: 'csv' | 'xlsx' | 'xps';
  hasHeaderRow: boolean;
  rows: string[][];
  totalRows: number;
  suggestedMapping: string[];
  fields: ImportField[];
}
interface MatchResult { lines: Line[]; fields: ImportField[] }

const money = (n: number) => `RD$ ${n.toFixed(2)}`;

export function RegisterInvoiceModal({
  tenantId, suppliers, onClose, onDone,
}: {
  tenantId: string;
  suppliers: SupplierOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [ncf, setNcf] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [applyItbis, setApplyItbis] = useState(true);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // sub-flujo de importación de archivo
  const [importOpen, setImportOpen] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);

  useEffect(() => {
    apiFetch<ProductOpt[]>('/catalog/products', tenantId)
      .then((p) => setProducts(p))
      .catch(() => setProducts([]));
  }, [tenantId]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unitCost, 0), [lines]);
  const itbis = applyItbis ? subtotal * 0.18 : 0;
  const total = subtotal + itbis;

  const addLine = () => setLines((l) => [...l, { rawName: '', quantity: 1, unitCost: 0, productId: null }]);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));

  const onFile = async (file: File) => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiUpload<ParseResult>('/purchasing/invoices/parse', tenantId, fd);
      setParsed(data);
      setMapping(data.suggestedMapping);
      setHasHeaderRow(data.hasHeaderRow);
      setImportOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el archivo'); }
    finally { setBusy(false); }
  };

  const applyImport = async () => {
    if (!parsed) return;
    if (!mapping.includes('name')) { setError('Indica cuál columna es la Descripción.'); return; }
    setBusy(true); setError('');
    try {
      const res = await apiFetch<MatchResult>('/purchasing/invoices/match', tenantId, {
        method: 'POST',
        body: JSON.stringify({ rows: parsed.rows, mapping, hasHeaderRow }),
      });
      setLines((l) => [...l, ...res.lines]);
      setImportOpen(false);
      setParsed(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al interpretar el archivo'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!supplierId) { setError('Selecciona un proveedor.'); return; }
    if (!invoiceNumber.trim()) { setError('Indica el número de factura.'); return; }
    const valid = lines.filter((l) => l.rawName.trim() && l.quantity > 0);
    if (valid.length === 0) { setError('Agrega al menos una línea válida.'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch('/purchasing/invoices', tenantId, {
        method: 'POST',
        body: JSON.stringify({
          supplierId, invoiceNumber, ncf: ncf || null, date,
          dueDate: dueDate || null, applyItbis, notes: notes || null,
          items: valid.map((l) => ({
            productId: l.productId, rawName: l.rawName, quantity: l.quantity, unitCost: l.unitCost,
          })),
        }),
      });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al registrar la factura'); }
    finally { setBusy(false); }
  };

  const colCount = parsed ? parsed.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;
  const previewRows = parsed ? parsed.rows.slice(hasHeaderRow ? 1 : 0, hasHeaderRow ? 7 : 6) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Registrar factura de compra</h2>
            <p className="text-xs text-slate-500">Escribe las líneas a mano o impórtalas de un CSV/Excel — revisa antes de aplicar al inventario</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

          {/* Datos de la factura */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Proveedor</span>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {suppliers.length === 0 && <option value="">— Crea un proveedor primero —</option>}
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.rnc ? ` · ${s.rnc}` : ''}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">N° de factura</span>
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Ej. 001-0012345" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">NCF (opcional)</span>
              <input value={ncf} onChange={(e) => setNcf(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="B01..." />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Fecha</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Vence (opcional)</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" checked={applyItbis} onChange={(e) => setApplyItbis(e.target.checked)} />
              La factura incluye ITBIS (18%)
            </label>
          </div>

          {/* Líneas */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Líneas / productos</h3>
              <div className="flex gap-2">
                <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  {busy ? 'Leyendo…' : '📄 Importar de archivo'}
                  <input type="file" accept=".csv,.xlsx,.xls,.xps,.txt" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} disabled={busy} />
                </label>
                <button onClick={addLine} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                  + Agregar línea
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
                Sin líneas todavía. Agrégalas a mano o importa un archivo.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2">Descripción (factura)</th>
                      <th className="px-3 py-2">Producto en inventario</th>
                      <th className="px-3 py-2 text-right">Cant.</th>
                      <th className="px-3 py-2 text-right">Costo unit.</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">
                          <input value={l.rawName} onChange={(e) => setLine(i, { rawName: e.target.value })}
                            className="w-full rounded border border-slate-200 px-2 py-1 text-sm" placeholder="Nombre según la factura" />
                        </td>
                        <td className="px-3 py-1.5">
                          <select value={l.productId ?? ''} onChange={(e) => setLine(i, { productId: e.target.value || null })}
                            className={`w-full rounded border px-2 py-1 text-sm ${l.productId ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
                            <option value="">— No actualizar stock —</option>
                            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" min={0} step="any" value={l.quantity}
                            onChange={(e) => setLine(i, { quantity: parseFloat(e.target.value) || 0 })}
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-sm" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="number" min={0} step="any" value={l.unitCost}
                            onChange={(e) => setLine(i, { unitCost: parseFloat(e.target.value) || 0 })}
                            className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-sm" />
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-700">
                          {money(l.quantity * l.unitCost)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => removeLine(i)} className="text-slate-400 hover:text-red-500">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-amber-600">
              ⚠️ Las líneas en ámbar no están vinculadas a un producto: no sumarán al inventario (solo cuentan en el gasto). Vincúlalas si quieres que suban el stock.
            </p>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Notas (opcional)</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>

          {/* Totales */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
              {applyItbis && <div className="flex justify-between"><span className="text-slate-500">ITBIS (18%)</span><span className="tabular-nums">{money(itbis)}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
          <button onClick={submit} disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? 'Guardando…' : 'Registrar factura'}
          </button>
        </div>
      </div>

      {/* Sub-modal: mapeo de columnas del archivo importado */}
      {importOpen && parsed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Mapea las columnas del archivo</h3>
                <p className="text-xs text-slate-500">{parsed.source.toUpperCase()} · {parsed.totalRows} fila(s)</p>
              </div>
              <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={hasHeaderRow} onChange={(e) => setHasHeaderRow(e.target.checked)} />
                La primera fila es encabezado
              </label>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      {Array.from({ length: colCount }).map((_, i) => (
                        <th key={i} className="border-b border-slate-200 px-2 py-2 text-left">
                          <select value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => { const c = [...m]; c[i] = e.target.value; return c; })}
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs font-semibold text-slate-700">
                            <option value="">— Ignorar —</option>
                            {parsed.fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, ri) => (
                      <tr key={ri} className="border-b border-slate-100">
                        {Array.from({ length: colCount }).map((_, ci) => (
                          <td key={ci} className="px-2 py-1.5 text-slate-600">{r[ci] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setImportOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
              <button onClick={applyImport} disabled={busy}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                {busy ? 'Interpretando…' : 'Traer líneas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
