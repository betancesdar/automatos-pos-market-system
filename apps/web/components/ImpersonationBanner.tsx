'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ImpersonationBanner() {
  const router = useRouter();
  const [impersonating, setImpersonating] = useState(false);
  const [tenantName, setTenantName] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;
    
    const token = localStorage.getItem('impersonation_token');
    const tenant = localStorage.getItem('impersonation_tenant');
    
    if (token && tenant) {
      setImpersonating(true);
      try {
        const tenantData = JSON.parse(tenant);
        setTenantName(tenantData.name);
      } catch (e) {
        setTenantName('Comercio');
      }
    }
  }, [mounted]);

  const exitImpersonation = () => {
    if (typeof window === 'undefined') return;
    
    // Clear impersonation data
    localStorage.removeItem('impersonation_token');
    localStorage.removeItem('impersonation_tenant');
    localStorage.removeItem('original_auth');
    
    // Redirect back to superadmin
    router.push('/superadmin');
  };

  // Don't render on server
  if (!mounted) return null;
  if (!impersonating) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 px-4 py-3 shadow-lg">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔐</span>
          <div>
            <p className="text-sm font-bold text-white">
              MODO SOPORTE ACTIVO
            </p>
            <p className="text-xs text-white/90">
              Estás viendo: <strong>{tenantName}</strong>
            </p>
          </div>
        </div>
        <button
          onClick={exitImpersonation}
          className="rounded-lg bg-white/20 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          ← Salir / Volver a SuperAdmin
        </button>
      </div>
    </div>
  );
}
