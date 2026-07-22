// Centralized formatting helpers — no hardcoded currency strings scattered across the UI.

export const CURRENCY = 'RD$';

export function formatCurrency(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return `${CURRENCY} ${n.toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('es-DO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-DO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
