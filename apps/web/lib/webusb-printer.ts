// WebUSB helper for direct printing to 80mm USB thermal receipt printers
// (e.g. "2Connect Thermal Receipt Printer USB POS80-01 V6" and similar
// generic ESC/POS USB printers). Falls back gracefully when WebUSB is not
// supported/paired — the caller (ReceiptPrinter) handles the fallback chain.

/**
 * Known USB Vendor IDs commonly used by generic/OEM 80mm thermal receipt
 * printers. Many "POS80" printers are re-badged units built around common
 * USB-to-serial or USB-printer-class chipsets, so we offer a broad set of
 * filters and always allow the user to pick "any device" if none match.
 */
export const THERMAL_PRINTER_VENDOR_IDS: number[] = [
  0x0483, // STMicroelectronics (common in generic POS80 boards)
  0x1a86, // QinHeng Electronics (CH340/CH341 — common generic USB-serial bridge)
  0x0416, // Winbond Electronics (some generic POS printers)
  0x04b8, // Seiko Epson
  0x0519, // Star Micronics
  0x1cbe, // Luminary Micro / generic POS controllers
  0x0fe6, // ICS Advent
  0x154f, // SNBC / Zjiang (very common white-label 80mm thermal printers)
  0x28e9, // GD32-based generic USB printer boards (also common in POS80 clones)
];

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

/** Silently reconnect to a USB thermal printer the user already granted access to. */
export async function getPairedWebUsbPrinter(): Promise<USBDevice | null> {
  if (!isWebUsbSupported()) return null;
  try {
    const devices = await navigator.usb!.getDevices();
    return devices[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Opens the browser's native USB device picker. Tries known thermal-printer
 * vendor IDs first; if the user's printer isn't in that list, falls back to
 * showing every connected USB device so it can still be paired manually.
 */
export async function requestWebUsbPrinter(): Promise<USBDevice> {
  if (!isWebUsbSupported()) {
    throw new Error('WebUSB no está soportado en este navegador (usa Chrome/Edge de escritorio).');
  }
  const knownFilters = THERMAL_PRINTER_VENDOR_IDS.map((vendorId) => ({ vendorId }));
  try {
    return await navigator.usb!.requestDevice({ filters: knownFilters });
  } catch {
    // Vendor ID fallback: let the user pick any USB device (e.g. an
    // unlisted/rebranded POS80 printer).
    return await navigator.usb!.requestDevice({ filters: [] });
  }
}

/** Opens the device, selects its first configuration, and claims the first available interface. */
export async function openWebUsbPrinter(device: USBDevice): Promise<{ device: USBDevice; endpointNumber: number }> {
  if (!device.opened) await device.open();

  if (!device.configuration) {
    await device.selectConfiguration(1);
  }

  const iface = device.configuration?.interfaces[0];
  if (!iface) throw new Error('El dispositivo USB no expone ninguna interfaz.');

  await device.claimInterface(iface.interfaceNumber);

  const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === 'out');
  if (!outEndpoint) throw new Error('No se encontró un endpoint de salida en la impresora USB.');

  return { device, endpointNumber: outEndpoint.endpointNumber };
}

/**
 * Garantiza que la impresora ya pareada esté lista ANTES de imprimir.
 * El sistema operativo suspende el USB por ahorro de energía y deja el handle
 * cerrado/colgado; aquí lo re-adquirimos en silencio sin pedir al usuario que
 * recargue la página. Devuelve el handle vivo + su endpoint de salida.
 */
export async function ensureWebUsbPrinterReady(
  device: USBDevice | null,
): Promise<{ device: USBDevice; endpointNumber: number }> {
  // Si no hay handle o el navegador lo invalidó, recuperar el dispositivo pareado.
  let dev = device;
  if (!dev || !dev.opened) {
    const paired = await getPairedWebUsbPrinter();
    if (paired) dev = paired;
  }
  if (!dev) throw new Error('No hay impresora USB pareada. Conéctala una vez con "Conectar impresora".');

  // Re-inicialización silenciosa (open → selectConfiguration → claimInterface).
  return openWebUsbPrinter(dev);
}

/**
 * Envía bytes ESC/POS con AUTO-SANACIÓN: verifica/reabre el dispositivo antes de
 * imprimir y, si `transferOut` falla (p. ej. "The device was disconnected"),
 * fuerza un re-open/re-claim y reintenta una vez. No requiere recargar la página.
 * Devuelve el handle vivo para que el llamador actualice su estado.
 */
export async function printToWebUsb(
  device: USBDevice | null,
  data: Uint8Array,
): Promise<{ device: USBDevice; endpointNumber: number }> {
  let ready = await ensureWebUsbPrinterReady(device);
  try {
    await sendRawToWebUsbPrinter(ready.device, ready.endpointNumber, data);
    return ready;
  } catch (err) {
    // El handle quedó obsoleto a mitad de camino → reabrir y reintentar una vez.
    try {
      try { if (ready.device.opened) await ready.device.close(); } catch { /* ignore */ }
    } catch { /* ignore */ }
    ready = await ensureWebUsbPrinterReady(null); // fuerza getDevices() fresco
    await sendRawToWebUsbPrinter(ready.device, ready.endpointNumber, data);
    return ready;
  }
}

/** Sends raw ESC/POS bytes directly to the USB printer's bulk-out endpoint. */
export async function sendRawToWebUsbPrinter(device: USBDevice, endpointNumber: number, data: Uint8Array): Promise<void> {
  const result = await device.transferOut(endpointNumber, data);
  if (result.status !== 'ok') {
    throw new Error(`Fallo al enviar datos a la impresora USB (status: ${result.status})`);
  }
}

export function base64ToUint8Array(base64: string): Uint8Array<ArrayBufferLike> {
  const binaryString = atob(base64);
  const data = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    data[i] = binaryString.charCodeAt(i);
  }
  return data;
}
