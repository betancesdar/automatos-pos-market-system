/**
 * Convierte un monto en pesos dominicanos a letras (para el pagaré notarial).
 * Ej.: 1250.50 → "MIL DOSCIENTOS CINCUENTA PESOS CON 50/100".
 */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const ESPECIALES: Record<number, string> = {
  10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
  16: 'DIECISÉIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
  20: 'VEINTE', 21: 'VEINTIUNO', 22: 'VEINTIDÓS', 23: 'VEINTITRÉS', 24: 'VEINTICUATRO',
  25: 'VEINTICINCO', 26: 'VEINTISÉIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
};
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorDeMil(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let out = '';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) out += CENTENAS[c] + ' ';
  if (resto > 0) {
    if (resto < 10) out += UNIDADES[resto];
    else if (ESPECIALES[resto]) out += ESPECIALES[resto];
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      out += DECENAS[d] + (u > 0 ? ' Y ' + UNIDADES[u] : '');
    }
  }
  return out.trim();
}

function enteroALetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const parts: string[] = [];
  if (millones > 0) parts.push(millones === 1 ? 'UN MILLÓN' : `${menorDeMil(millones)} MILLONES`);
  if (miles > 0) parts.push(miles === 1 ? 'MIL' : `${menorDeMil(miles)} MIL`);
  if (resto > 0) parts.push(menorDeMil(resto));
  return parts.join(' ').trim();
}

export function montoEnLetras(amount: number): string {
  const entero = Math.floor(Math.abs(amount));
  const centavos = Math.round((Math.abs(amount) - entero) * 100);
  const letras = enteroALetras(entero);
  const pesos = entero === 1 ? 'PESO DOMINICANO' : 'PESOS DOMINICANOS';
  return `${letras} ${pesos} CON ${String(centavos).padStart(2, '0')}/100`;
}
