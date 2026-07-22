'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Receipt configuration has been relocated into the unified Settings page
// (Configuración → Recibos / Impresora). This route now redirects there.
export default function ReceiptSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/settings');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 font-sans text-slate-400">
      Redirigiendo a Configuración…
    </div>
  );
}
