'use client';

import { useEffect, useState } from 'react';
import {
  base64ToUint8Array,
  getPairedWebUsbPrinter,
  isWebUsbSupported,
  openWebUsbPrinter,
  printToWebUsb,
  requestWebUsbPrinter,
} from '../lib/webusb-printer';
import { printThermalReceiptHtml, type ThermalReceiptData } from '../lib/thermal-receipt';

interface ReceiptPrinterProps {
  /**
   * "floating" (default): the original always-visible bottom-right button
   * stack — used on pages without a dedicated header slot (e.g. /admin).
   * "compact": a small dropdown icon meant to be dropped into a header/top
   * nav bar (e.g. the POS), so it doesn't obstruct the checkout area.
   */
  variant?: 'floating' | 'compact';
}

/**
 * Handles connection + printing for 80mm USB thermal receipt printers.
 *
 * Fallback chain (in priority order):
 *   1. WebUSB — direct raw ESC/POS bytes to a paired USB thermal printer
 *      (e.g. "2Connect Thermal Receipt Printer USB POS80-01 V6").
 *   2. Web Serial — for printers exposed as a serial/COM device.
 *   3. Silent/window HTML print — optimized 80mm CSS receipt, used whenever
 *      no printer is connected/paired or the browser lacks WebUSB/Serial
 *      support (e.g. Safari/Firefox).
 */
export function ReceiptPrinter({ variant = 'floating' }: ReceiptPrinterProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [serialPort, setSerialPort] = useState<SerialPort | null>(null);
  const [usbDevice, setUsbDevice] = useState<USBDevice | null>(null);
  const [usbEndpoint, setUsbEndpoint] = useState<number | null>(null);
  const [usbConnecting, setUsbConnecting] = useState(false);

  // On mount, try to silently reuse a USB printer the user already granted
  // permission for in a previous session (no picker prompt needed).
  useEffect(() => {
    (async () => {
      const paired = await getPairedWebUsbPrinter();
      if (paired) {
        try {
          const { device, endpointNumber } = await openWebUsbPrinter(paired);
          setUsbDevice(device);
          setUsbEndpoint(endpointNumber);
        } catch (err) {
          console.warn('No se pudo reabrir la impresora USB emparejada:', err);
        }
      }
    })();
  }, []);

  // Mantener el handle USB fresco: limpiar al desconectar y re-vincular al
  // reconectar, para que la impresión se auto-sane sin recargar la página.
  useEffect(() => {
    if (!isWebUsbSupported() || !navigator.usb) return;
    const onDisconnect = (e: Event) => {
      const dev = (e as unknown as { device?: USBDevice }).device;
      if (usbDevice && dev === usbDevice) {
        setUsbDevice(null);
        setUsbEndpoint(null);
      }
    };
    const onConnect = async () => {
      if (usbDevice) return;
      const paired = await getPairedWebUsbPrinter();
      if (!paired) return;
      try {
        const { device, endpointNumber } = await openWebUsbPrinter(paired);
        setUsbDevice(device);
        setUsbEndpoint(endpointNumber);
      } catch { /* ignore — se reintentará al imprimir */ }
    };
    navigator.usb.addEventListener('disconnect', onDisconnect);
    navigator.usb.addEventListener('connect', onConnect);
    return () => {
      navigator.usb?.removeEventListener('disconnect', onDisconnect);
      navigator.usb?.removeEventListener('connect', onConnect);
    };
  }, [usbDevice]);

  const connectUsbPrinter = async () => {
    if (!isWebUsbSupported()) {
      alert('WebUSB no está soportado en este navegador. Usa Chrome o Edge de escritorio, o conecta por Web Serial.');
      return;
    }
    setUsbConnecting(true);
    try {
      const device = await requestWebUsbPrinter();
      const { endpointNumber } = await openWebUsbPrinter(device);
      setUsbDevice(device);
      setUsbEndpoint(endpointNumber);
    } catch (err) {
      console.error('Error conectando impresora USB (WebUSB):', err);
    } finally {
      setUsbConnecting(false);
    }
  };

  const connectSerialPrinter = async () => {
    try {
      if (!('serial' in navigator) || !navigator.serial) {
        alert('Web Serial API no está soportada en este navegador (usa Chrome/Edge).');
        return;
      }
      const newPort = await navigator.serial.requestPort();
      await newPort.open({ baudRate: 9600 }); // Common for POS printers
      setSerialPort(newPort);
    } catch (err) {
      console.error('Error connecting to printer:', err);
    }
  };

  /**
   * Prints a receipt using the best available channel:
   * WebUSB > Web Serial > HTML window print (80mm CSS fallback).
   *
   * @param base64RawString ESC/POS payload (base64) — used for WebUSB/Serial.
   * @param thermalData     Structured receipt data — used for the HTML fallback.
   */
  const printReceipt = async (base64RawString: string, thermalData?: ThermalReceiptData) => {
    // Offline sales have no server-generated ESC/POS payload yet (it's built
    // when the sale finally syncs) — go straight to the HTML fallback so we
    // never send an empty/garbage buffer to a connected USB/Serial printer.
    const hasRawPayload = !!base64RawString;

    try {
      // WebUSB con auto-sanación: verifica/reabre el handle y reintenta si el SO
      // suspendió el USB, sin forzar al cajero a recargar la página.
      if (hasRawPayload && isWebUsbSupported() && (usbDevice || (await getPairedWebUsbPrinter()))) {
        const data = base64ToUint8Array(base64RawString);
        const ready = await printToWebUsb(usbDevice, data);
        if (ready.device !== usbDevice) setUsbDevice(ready.device);
        setUsbEndpoint(ready.endpointNumber);
        return;
      }

      if (hasRawPayload && serialPort) {
        const writer = serialPort.writable?.getWriter();
        if (!writer) throw new Error('Cannot get writable stream');
        const data = base64ToUint8Array(base64RawString);
        await writer.write(data);
        writer.releaseLock();
        return;
      }

      // No USB/Serial printer connected — fall back to silent/window printing.
      if (thermalData) {
        printThermalReceiptHtml(thermalData);
      } else {
        console.warn('No hay impresora conectada (USB/Serial) y no se proporcionaron datos para el recibo HTML.');
      }
    } catch (err) {
      console.error('Error printing, falling back to HTML receipt:', err);
      if (thermalData) printThermalReceiptHtml(thermalData);
    }
  };

  // Expose print method globally so the POS page can call it
  if (typeof window !== 'undefined') {
    (window as any).printReceipt = printReceipt;
  }

  const connected = !!usbDevice || !!serialPort;

  // ── "compact" variant: small dropdown icon for a header/top-nav bar ──
  if (variant === 'compact') {
    return (
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title="Conexión de impresora térmica"
        >
          <span>🖨️</span>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </button>

        {menuOpen && (
          <>
            {/* Click-outside overlay */}
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-50 mt-2 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Impresora Térmica 80mm</p>
              <button
                onClick={connectUsbPrinter}
                disabled={usbConnecting}
                className={`w-full rounded-lg px-4 py-2 text-left text-sm font-bold text-white shadow ${
                  usbDevice ? 'bg-green-600' : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {usbDevice
                  ? '🖨️ Impresora USB Conectada'
                  : usbConnecting
                    ? 'Conectando…'
                    : '🔌 Conectar Impresora USB (WebUSB)'}
              </button>
              {!usbDevice && (
                <button
                  onClick={connectSerialPrinter}
                  className={`w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-white shadow ${
                    serialPort ? 'bg-green-600' : 'bg-slate-500 hover:bg-slate-400'
                  }`}
                >
                  {serialPort ? '✅ Serial Conectada' : 'Conectar por Web Serial'}
                </button>
              )}
              {!connected && (
                <span className="block rounded bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800">
                  Sin impresora conectada · se usará impresión por ventana (80mm)
                </span>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── "floating" variant (default, unchanged): original always-visible stack ──
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      <button
        onClick={connectUsbPrinter}
        disabled={usbConnecting}
        className={`px-4 py-2 rounded-lg font-bold text-white shadow-lg ${
          usbDevice ? 'bg-green-600' : 'bg-slate-700 hover:bg-slate-600'
        }`}
      >
        {usbDevice
          ? '🖨️ Impresora USB Conectada'
          : usbConnecting
            ? 'Conectando…'
            : '🔌 Conectar Impresora USB (WebUSB)'}
      </button>
      {!usbDevice && (
        <button
          onClick={connectSerialPrinter}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow ${
            serialPort ? 'bg-green-600' : 'bg-slate-500 hover:bg-slate-400'
          }`}
        >
          {serialPort ? '✅ Serial Conectada' : 'Conectar por Web Serial'}
        </button>
      )}
      {!connected && (
        <span className="rounded bg-amber-100 px-2 py-1 text-[10px] font-medium text-amber-800 shadow">
          Sin impresora conectada · se usará impresión por ventana (80mm)
        </span>
      )}
    </div>
  );
}
