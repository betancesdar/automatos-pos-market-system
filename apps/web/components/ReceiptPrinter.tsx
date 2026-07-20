'use client';

import { useState } from 'react';

export function ReceiptPrinter() {
  const [port, setPort] = useState<SerialPort | null>(null);

  const connectPrinter = async () => {
    try {
      if (!('serial' in navigator)) {
        alert('Web Serial API no está soportada en este navegador (usa Chrome/Edge).');
        return;
      }
      
      const newPort = await navigator.serial.requestPort();
      await newPort.open({ baudRate: 9600 }); // Common for POS printers
      setPort(newPort);
      console.log('Printer connected');
    } catch (err) {
      console.error('Error connecting to printer:', err);
    }
  };

  const printReceipt = async (base64RawString: string) => {
    if (!port) {
      alert('Impresora no conectada.');
      return;
    }

    try {
      const writer = port.writable?.getWriter();
      if (!writer) throw new Error('Cannot get writable stream');

      // Decode base64 to binary string, then to Uint8Array
      const binaryString = atob(base64RawString);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }

      await writer.write(data);
      writer.releaseLock();
    } catch (err) {
      console.error('Error printing:', err);
    }
  };

  // Expose print method globally so the POS page can call it
  if (typeof window !== 'undefined') {
    (window as any).printReceipt = printReceipt;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={connectPrinter}
        className={`px-4 py-2 rounded-lg font-bold text-white shadow-lg ${
          port ? 'bg-green-600' : 'bg-slate-700 hover:bg-slate-600'
        }`}
      >
        {port ? '🖨️ Impresora Conectada' : '🔌 Conectar Impresora USB'}
      </button>
    </div>
  );
}
