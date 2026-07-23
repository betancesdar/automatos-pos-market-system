'use client';

import { useEffect, useState } from 'react';
import {
  base64ToUint8Array,
  getPairedWebUsbPrinter,
  isWebUsbSupported,
  openWebUsbPrinter,
  requestWebUsbPrinter,
  sendRawToWebUsbPrinter,
} from '../lib/webusb-printer';
import { printThermalReceiptHtml, type ThermalReceiptData } from '../lib/thermal-receipt';

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
export function ReceiptPrinter() {
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
    try {
      if (usbDevice && usbEndpoint !== null) {
        const data = base64ToUint8Array(base64RawString);
        await sendRawToWebUsbPrinter(usbDevice, usbEndpoint, data);
        return;
      }

      if (serialPort) {
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
