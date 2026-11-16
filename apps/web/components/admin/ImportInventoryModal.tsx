'use client';

import { useState } from 'react';
import { apiFetch, apiUpload } from '../../lib/api';

interface ImportField { value: string; label: string }
interface ParseResult {
  source: 'csv' | 'xlsx' | 'xps';
  hasHeaderRow: boolean;
  rows: string[][];
  totalRows: number;
  suggestedMapping: string[];
  fields: ImportField[];
}
interface CommitResult {
  created: number; updated: number; skipped: number;
  errorCount: number; processed: number;
  errors: { row: number; name: string; reason: string }[];
}

type Step = 'upload' | 'map' | 'done';

export function ImportInventoryModal({
  tenantId, onClose, onDone,
}: { tenantId: string; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [opts, setOpts] = useState({ updateExisting: true, createMissingCategories: true, createMissingZones: true });
  const [result, setResult] = useState<CommitResult | null>(null);

  const onFile = async (file: File) => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiUpload<ParseResult>('/catalog/import/parse', tenantId, fd);
      setParsed(data);
      setMapping(data.suggestedMapping);
      setHasHeaderRow(data.hasHeaderRow);
      setStep('map');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer el archivo'); }
    finally { setBusy(false); }
  };

  const setCol = (i: number, field: string) => {
    setMapping((m) => { const copy = [...m]; copy[i] = field; return copy; });
  };

  const commit = async () => {
    if (!parsed) return;
    if (!mapping.includes('name')) { setError('Debes indicar cuál columna es el Nombre del producto.'); return; }
    setBusy(true); setError('');
    try {
      const res = await apiFetch<CommitResult>('/catalog/import/commit', tenantId, {
        method: 'POST',
        body: JSON.stringify({ rows: parsed.rows, mapping, hasHeaderRow, options: opts }),
      });
      setResult(res); setStep('done');
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al importar'); }
    finally { setBusy(false); }
  };

  const previewRows = parsed ? parsed.rows.slice(hasHeaderRow ? 1 : 0, hasHeaderRow ? 9 : 8) : [];
  const colCount = parsed ? parsed.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Importar inventario</h2>
            <p className="text-xs text-slate-500">CSV, Excel (.xlsx) o XPS del sistema anterior</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

          {step === 'upload' && (
            <div className="rounded-xl border-2 border-dashed border-slate-300 p-10 text-center">
              <p className="mb-1 text-sm font-medium text-slate-700">Selecciona el archivo a importar</p>
              <p className="mb-4 text-xs text-slate-400">Formatos: .csv, .xlsx, .xps — máximo 15 MB</p>
              <label className="inline-block cursor-pointer rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
                {busy ? 'Leyendo…' : 'Elegir archivo'}
                <input type="file" accept=".csv,.xlsx,.xls,.xps,.txt" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} disabled={busy} />
              </label>
              <p className="mt-4 text-[11px] text-slate-400">
                💡 El XPS es un formato de impresión: su lectura es «mejor esfuerzo». Si tu sistema puede exportar CSV o Excel, esos son 100% fiables.
              </p>
            </div>
          )}

          {step === 'map' && parsed && (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <span className="font-semibold text-slate-700">Archivo: {parsed.source.toUpperCase()}</span>
                <span className="text-slate-500">{parsed.totalRows} fila(s) leída(s)</span>
                <label className="flex items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={hasHeaderRow} onChange={(e) => setHasHeaderRow(e.target.checked)} />
                  La primera fila es encabezado
                </label>
              </div>

              <p className="text-xs text-slate-500">Indica qué es cada columna (lo que diga «Ignorar» no se importa):</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      {Array.from({ length: colCount }).map((_, i) => (
                        <th key={i} className="border-b border-slate-200 px-2 py-2 text-left">
                          <select value={mapping[i] ?? ''} onChange={(e) => setCol(i, e.target.value)}
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

              <div className="flex flex-wrap gap-4 rounded-lg border border-slate-200 p-3 text-sm">
                <label className="flex items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={opts.updateExisting} onChange={(e) => setOpts({ ...opts, updateExisting: e.target.checked })} />
                  Actualizar productos existentes (match por código/SKU)
                </label>
                <label className="flex items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={opts.createMissingCategories} onChange={(e) => setOpts({ ...opts, createMissingCategories: e.target.checked })} />
                  Crear categorías faltantes
                </label>
                <label className="flex items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={opts.createMissingZones} onChange={(e) => setOpts({ ...opts, createMissingZones: e.target.checked })} />
                  Crear zonas faltantes
                </label>
              </div>
            </>
          )}

          {step === 'done' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-2xl font-black text-emerald-700">{result.created}</p><p className="text-xs text-emerald-600">Creados</p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-2xl font-black text-blue-700">{result.updated}</p><p className="text-xs text-blue-600">Actualizados</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-2xl font-black text-slate-600">{result.skipped}</p><p className="text-xs text-slate-500">Omitidos</p>
                </div>
              </div>
              {result.errorCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1 text-sm font-semibold text-amber-800">{result.errorCount} fila(s) con problemas:</p>
                  <div className="max-h-40 overflow-y-auto text-xs text-amber-700">
                    {result.errors.map((e, i) => <div key={i}>Fila {e.row} ({e.name || 'sin nombre'}): {e.reason}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
          {step === 'map' && (
            <>
              <button onClick={() => { setStep('upload'); setParsed(null); setError(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">
                ← Volver
              </button>
              <button onClick={commit} disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                {busy ? 'Importando…' : 'Importar productos'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onDone} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500">
              Listo
            </button>
          )}
          {step === 'upload' && (
            <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600">Cancelar</button>
          )}
        </div>
      </div>
    </div>
  );
}
