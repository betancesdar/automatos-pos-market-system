'use client';

import { useEffect, useRef } from 'react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'SELECT';

      // Ignore if user is manually typing in an input
      if (isInputFocused) return;

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // Scanners type very fast (usually < 30ms per character)
      if (timeDiff > 50) {
        bufferRef.current = ''; // Reset if typing is too slow (human)
      }

      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) {
          onScan(bufferRef.current);
          bufferRef.current = '';
          e.preventDefault();
        }
      } else if (e.key.length === 1) { // Normal character
        bufferRef.current += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onScan]);

  return null; // This is a logic-only component
}
