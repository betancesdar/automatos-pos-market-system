import { Workbook } from 'exceljs';
import { Readable } from 'stream';

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
}

/** Construye un CSV o XLSX (en memoria) a partir de columnas + filas. */
export async function buildSpreadsheet(
  format: 'csv' | 'xlsx',
  sheetName: string,
  columns: SheetColumn[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || 'Hoja1');
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  const buf =
    format === 'csv' ? await wb.csv.writeBuffer() : await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/**
 * Lee un archivo tabular (CSV o XLSX) a una matriz de strings (fila x columna).
 * La primera fila normalmente son los encabezados; el llamador decide el mapeo.
 */
export async function readTabular(buffer: Buffer, ext: string): Promise<string[][]> {
  const wb = new Workbook();
  if (ext === 'xlsx' || ext === 'xls') {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } else {
    // CSV: ExcelJS lee desde un stream de texto.
    await wb.csv.read(Readable.from(buffer.toString('utf8')));
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    // row.values es 1-indexado (índice 0 vacío).
    const raw = (row.values as unknown[]).slice(1);
    const cells = raw.map((v) => cellToString(v));
    rows.push(cells);
  });
  return rows;
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.result !== 'undefined') return String(o.result);
    if (o.richText && Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((p) => p.text ?? '').join('');
    }
    if (o.hyperlink && typeof o.text === 'string') return o.text as string;
  }
  return String(v);
}
