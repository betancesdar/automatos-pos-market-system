'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Resumen', icon: '📊' },
  { href: '/admin/inventory', label: 'Inventario', icon: '📦' },
  { href: '/admin/sales', label: 'Facturas', icon: '🧾' },
  { href: '/admin/shifts', label: 'Turnos & Caja', icon: '💵' },
  { href: '/admin/reports', label: 'Reportes', icon: '📈' },
  { href: '/admin/settings', label: 'Configuración', icon: '⚙️' },
];

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  const NavLinks = () => (
    <nav className="space-y-1">
      {NAV.map((item) => (
        <button
          key={item.href}
          onClick={() => {
            router.push(item.href);
            setMobileOpen(false);
          }}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive(item.href)
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span className="text-base">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div className="flex">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
          <div className="mb-6 px-2">
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-indigo-600">Mini</span>Market OS
            </h1>
            <p className="text-xs text-slate-400">Panel de administración</p>
          </div>
          <NavLinks />
          <div className="mt-auto space-y-1 border-t border-slate-100 pt-4">
            <button
              onClick={() => router.push('/pos')}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <span className="text-base">🛒</span> Ir al POS
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50"
            >
              <span className="text-base">⎋</span> Cerrar sesión
            </button>
          </div>
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
            <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-200 bg-white p-4">
              <div className="mb-6 flex items-center justify-between px-2">
                <h1 className="text-lg font-bold">
                  <span className="text-indigo-600">Mini</span>Market OS
                </h1>
                <button onClick={() => setMobileOpen(false)} className="text-slate-400">✕</button>
              </div>
              <NavLinks />
            </aside>
          </div>
        )}

        {/* Main */}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileOpen(true)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
                  aria-label="Abrir menú"
                >
                  ☰
                </button>
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
                  {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {actions}
                {user && (
                  <div className="ml-1 hidden text-right sm:block">
                    <p className="text-sm font-semibold text-slate-700">{user.name}</p>
                    <p className="text-xs text-slate-400">{user.role}</p>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-screen-2xl space-y-8 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

// Shared presentational primitives reused across admin pages.
export function MetricCard({
  label,
  value,
  sub,
  accent = 'text-slate-900',
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const isVoid = status === 'VOIDED';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        isVoid
          ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isVoid ? 'bg-red-500' : 'bg-emerald-500'}`} />
      {isVoid ? 'Anulada' : 'Completada'}
    </span>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
