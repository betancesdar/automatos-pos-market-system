'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth-context';

const MODULES = [
  {
    title: 'Terminal POS',
    description: 'Escaneo de códigos, carrito rápido, facturación con NCF y recibo ESC/POS.',
    href: '/pos',
    icon: '🛒',
    accent: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    title: 'Panel Admin',
    description: 'Resumen financiero, inventario, reportes DGII y cierre de caja en tiempo real.',
    href: '/admin',
    icon: '📊',
    accent: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    adminOnly: true,
  },
  {
    title: 'Configuración',
    description: 'Datos del colmado, RNC, secuencias NCF autorizadas y gestión de empleados.',
    href: '/admin',
    icon: '⚙️',
    accent: 'border-amber-200 bg-amber-50 text-amber-700',
    adminOnly: true,
  },
];

const FEATURES = [
  'Facturación fiscal RD (B01, B02, B15)',
  'Control de inventario y stock automático',
  'Reporte Formato 607 exportable',
  'Roles ADMIN y CAJERO con acceso restringido',
  'Cierre de caja con sobrantes y faltantes',
  'Lista de compras inteligente por velocidad de venta',
];

export default function HomePage() {
  const { user, logout, loading } = useAuth();

  const primaryHref = !user ? '/login' : user.role === 'CASHIER' ? '/pos' : '/admin';
  const primaryLabel = !user ? 'Iniciar Sesión' : user.role === 'CASHIER' ? 'Abrir POS' : 'Ir al Panel';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white">
              M
            </span>
            <span className="text-lg font-bold tracking-tight">
              <span className="text-indigo-600">Mini</span>Market OS
            </span>
          </div>

          <nav className="flex items-center gap-3">
            {!loading && user ? (
              <>
                <span className="hidden text-sm text-slate-500 sm:inline">
                  {user.name} · <span className="font-medium text-slate-700">{user.role}</span>
                </span>
                <Link
                  href="/pos"
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  POS
                </Link>
                {user.role === 'ADMIN' && (
                  <Link
                    href="/admin"
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Admin
                  </Link>
                )}
                <button
                  onClick={logout}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
                >
                  Salir
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Iniciar Sesión
                </Link>
                <Link
                  href="/login?redirect=/pos"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Acceder al POS
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-indigo-600">
              Sistema para colmados · República Dominicana
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-900 md:text-5xl">
              Punto de venta, inventario y contabilidad fiscal en un solo lugar
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              MiniMarket OS centraliza ventas en caja, control de stock, comprobantes NCF,
              reportes DGII y cierre de caja — diseñado para minimarkets y colmados que
              necesitan operar con orden y cumplimiento fiscal.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={primaryHref}
                className="rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500"
              >
                {primaryLabel}
              </Link>
              <Link
                href="/login?redirect=/pos"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Terminal POS
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Módulos del sistema</h2>
        <p className="mt-2 text-slate-500">Accede directamente a cada área operativa</p>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {MODULES.map((mod) => {
            const blocked = mod.adminOnly && user?.role === 'CASHIER';
            return (
              <div
                key={mod.title}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <span className={`mb-4 inline-flex w-fit rounded-lg border px-3 py-1 text-2xl ${mod.accent}`}>
                  {mod.icon}
                </span>
                <h3 className="text-lg font-bold text-slate-900">{mod.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{mod.description}</p>
                {blocked ? (
                  <p className="mt-4 text-xs font-medium text-slate-400">Solo disponible para ADMIN</p>
                ) : (
                  <Link
                    href={user ? mod.href : `/login?redirect=${mod.href}`}
                    className="mt-4 inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-500"
                  >
                    Abrir módulo →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-12 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Listo para operar comercialmente</h2>
              <p className="mt-3 text-slate-600">
                Cada acción del frontend está conectada a la API y persiste en PostgreSQL
                vía Prisma — sin pantallas estáticas ni datos de demostración hardcodeados.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Quick access */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-8 md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">¿Primera vez aquí?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Usa las credenciales demo tras ejecutar el seed de la base de datos.
            </p>
            <div className="mt-4 space-y-1 font-mono text-xs text-slate-500">
              <p>dario@minimarket-os.com / superadmin2026 → Super Admin</p>
              <p>admin@elprimo.com / admin123 → Panel completo</p>
              <p>cajero@elprimo.com / cajero123 → Solo POS</p>
            </div>
          </div>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-xl bg-indigo-600 px-8 py-3 text-center font-semibold text-white hover:bg-indigo-500 md:mt-0"
          >
            Comenzar ahora
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-slate-500">
          <p>
            <span className="font-semibold text-slate-700">MiniMarket OS</span>
            {' '}— Sistema de gestión para colmados
          </p>
          <div className="flex gap-4">
            <Link href="/pos" className="hover:text-slate-800">POS</Link>
            <Link href="/admin" className="hover:text-slate-800">Admin</Link>
            <Link href="/login" className="hover:text-slate-800">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
