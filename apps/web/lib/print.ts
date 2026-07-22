// Print / Export-to-PDF helper.
// Opens a clean, letter/A4-optimized document and triggers the browser print
// dialog, from which the user can "Save as PDF".

const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0f172a;
    margin: 0;
    padding: 32px 40px;
    font-size: 12px;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; color: #334155; }
  .muted { color: #64748b; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px; }
  .kpis { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
  .kpi { flex: 1; min-width: 140px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
  .kpi .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
  .kpi .value { font-size: 18px; font-weight: 700; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f8fafc; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  @page { size: auto; margin: 12mm; }
`;

export function printDocument(title: string, bodyHtml: string) {
  if (typeof window === 'undefined') return;
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    alert('Habilita las ventanas emergentes para exportar a PDF.');
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_STYLES}</style>
</head>
<body>
  ${bodyHtml}
  <div class="footer">Generado por MiniMarket OS · ${new Date().toLocaleString('es-DO')}</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  // Give the new window a tick to render before printing.
  setTimeout(() => {
    win.print();
  }, 300);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
