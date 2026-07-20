'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login?redirect=/admin');
      return;
    }
    if (user.role === 'CASHIER') {
      router.replace('/pos');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 font-sans text-slate-500">
        Cargando…
      </div>
    );
  }

  if (user.role === 'CASHIER') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 font-sans text-slate-500">
        Redirigiendo al POS…
      </div>
    );
  }

  return <>{children}</>;
}
