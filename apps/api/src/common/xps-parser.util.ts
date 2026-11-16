import JSZip from 'jszip';

/**
 * Lector "mejor esfuerzo" de inventarios en formato XPS (XML Paper Specification).
 *
 * El XPS es un formato de IMPRESIÓN, no de datos: internamente son "glifos" de
 * texto posicionados por coordenadas X/Y (como un PDF), sin estructura de tabla.
 * Aquí descomprimimos el paquete (es un ZIP), extraemos cada glifo con su
 * posición, y reconstruimos filas (agrupando por Y) y columnas (separando por
 * saltos grandes en X). El resultado se muestra en una previsualización donde el
 * usuario mapea las columnas, así que no necesita ser perfecto.
 */

interface Glyph {
  x: number;
  y: number;
  em: number; // FontRenderingEmSize (≈ tamaño de fuente)
  text: string;
}

export async function parseXpsToRows(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const pageNames = Object.keys(zip.files)
    .filter((n) => n.toLowerCase().endsWith('.fpage'))
    .sort(naturalSort);

  if (pageNames.length === 0) {
    throw new Error('El archivo no parece un XPS válido (no se encontraron páginas .fpage).');
  }

  const allRows: string[][] = [];
  for (const name of pageNames) {
    const xml = await zip.files[name].async('string');
    const glyphs = extractGlyphs(xml);
    allRows.push(...glyphsToRows(glyphs));
  }
  return allRows;
}

const GLYPHS_RE = /<Glyphs\b([^>]*?)\/?>/g;
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"/g;

function extractGlyphs(xml: string): Glyph[] {
  const glyphs: Glyph[] = [];
  let m: RegExpExecArray | null;
  while ((m = GLYPHS_RE.exec(xml)) !== null) {
    const attrsStr = m[1];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(attrsStr)) !== null) attrs[a[1]] = a[2];

    const text = decodeXmlEntities(attrs.UnicodeString ?? '');
    if (!text.trim()) continue;
    const x = parseFloat(attrs.OriginX ?? '0') || 0;
    const y = parseFloat(attrs.OriginY ?? '0') || 0;
    const em = parseFloat(attrs.FontRenderingEmSize ?? '12') || 12;
    glyphs.push({ x, y, em, text });
  }
  return glyphs;
}

function glyphsToRows(glyphs: Glyph[]): string[][] {
  if (glyphs.length === 0) return [];
  // Ordenar por Y (fila) y luego X (columna).
  const sorted = [...glyphs].sort((g1, g2) => g1.y - g2.y || g1.x - g2.x);

  const rows: Glyph[][] = [];
  let current: Glyph[] = [];
  let rowY = sorted[0].y;
  const rowTol = Math.max(4, sorted[0].em * 0.6); // tolerancia vertical

  for (const g of sorted) {
    if (Math.abs(g.y - rowY) > rowTol && current.length) {
      rows.push(current);
      current = [];
    }
    if (current.length === 0) rowY = g.y;
    current.push(g);
  }
  if (current.length) rows.push(current);

  return rows.map(rowToCells).filter((cells) => cells.some((c) => c.trim() !== ''));
}

/** Une glifos de una fila en celdas: un salto horizontal grande inicia columna. */
function rowToCells(row: Glyph[]): string[] {
  const ordered = [...row].sort((a, b) => a.x - b.x);
  const cells: string[] = [];
  let buf = '';
  let prevEnd = -Infinity;
  let prevEm = ordered[0]?.em ?? 12;

  for (const g of ordered) {
    const approxWidth = g.text.length * g.em * 0.5;
    const gap = g.x - prevEnd;
    // Hueco > ~1.5 "em" respecto al final del glifo anterior → nueva celda.
    if (buf !== '' && gap > prevEm * 1.5) {
      cells.push(buf.trim());
      buf = '';
    }
    buf += (buf && gap > prevEm * 0.25 ? ' ' : '') + g.text;
    prevEnd = g.x + approxWidth;
    prevEm = g.em;
  }
  if (buf.trim()) cells.push(buf.trim());
  return cells;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Orden natural para que Page1, Page2, …, Page10 queden en orden. */
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
