'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { useAuth } from '../lib/auth-context';

// ─────────────────────────────────────────────────────────────────────────
// Helpers de movimiento (puramente visuales — no tocan ninguna ruta/función)
// ─────────────────────────────────────────────────────────────────────────

/** Envuelve contenido con una inclinación 3D sutil que sigue al cursor. */
function TiltCard({
  children,
  className = '',
  max = 8,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 150, damping: 18 });

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  };
  const onLeave = () => { px.set(0.5); py.set(0.5); };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Aparece con fade + slide-up al entrar en el viewport. */
function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function ParallaxLayer({
  children,
  depth,
  mouseX,
  mouseY,
  className = '',
}: {
  children: React.ReactNode;
  depth: number;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  className?: string;
}) {
  const x = useSpring(useTransform(mouseX, (v) => v * depth), { stiffness: 80, damping: 20 });
  const y = useSpring(useTransform(mouseY, (v) => v * depth), { stiffness: 80, damping: 20 });
  return (
    <motion.div style={{ x, y }} className={className}>
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Contenido (todo describe funcionalidad real del sistema — nada inventado)
// ─────────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '#modulos', label: 'Módulos' },
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#fiscal', label: 'Facturación DGII' },
];

const MARQUEE_ITEMS = [
  'Facturación e-CF · DGII', 'Inventario multi-zona', 'Crédito y pagarés notariales',
  'Caja con cuadre ciego', 'Reportes avanzados', 'Modo Offline-first',
  'Impresión térmica WebUSB', 'Multi-negocio (SuperAdmin)', 'Roles y permisos a la medida',
];

const FEATURES = [
  { icon: '🛒', title: 'Punto de Venta', desc: 'Carrito como protagonista, panel de productos flotante, escaneo de código de barra y pago en efectivo, tarjeta o transferencia.', color: 'from-emerald-400 to-emerald-600' },
  { icon: '🧾', title: 'Facturación Electrónica', desc: 'Comprobantes fiscales (NCF / e-CF) conectados directamente con la DGII. El RNC autocompleta el nombre del cliente.', color: 'from-indigo-400 to-indigo-600' },
  { icon: '📦', title: 'Inventario', desc: 'Zonas de almacén, fotos o tabla compacta según tu negocio, e importación/exportación en CSV, Excel o desde tu sistema anterior (XPS).', color: 'from-amber-400 to-amber-600' },
  { icon: '💳', title: 'Crédito y Cobros', desc: 'Ventas a crédito por cuotas o por días, pagaré notarial automático, y mora configurable (o condonable) por cliente.', color: 'from-rose-400 to-rose-600' },
  { icon: '🔒', title: 'Control de Caja', desc: 'Apertura y cierre con cuadre a ciegas, movimientos de entrada/salida, y la opción de pasar el efectivo contado como fondo del siguiente turno.', color: 'from-cyan-400 to-cyan-600' },
  { icon: '📊', title: 'Reportes Avanzados', desc: 'Constructor de reportes por producto, categoría, zona, cajero o forma de pago — con totales y exportación a Excel/CSV.', color: 'from-violet-400 to-violet-600' },
  { icon: '🏢', title: 'Multi-negocio', desc: 'Un SuperAdmin centralizado administra todos tus comercios, planes, roles personalizados y permisos granulares por usuario.', color: 'from-blue-400 to-blue-600' },
  { icon: '📡', title: 'Modo Offline', desc: 'El POS sigue vendiendo sin internet y sincroniza automáticamente en cuanto vuelve la conexión — ninguna venta se pierde.', color: 'from-teal-400 to-teal-600' },
  { icon: '🖨️', title: 'Impresión Térmica', desc: 'Impresoras ESC/POS por WebUSB con reconexión automática — se acabaron los congelamientos a mitad de turno.', color: 'from-orange-400 to-orange-600' },
];

const STEPS = [
  { n: '01', title: 'Configura tu negocio', desc: 'Carga tu inventario (manual o importado), define zonas, roles de tu equipo y tu facturación fiscal.' },
  { n: '02', title: 'Vende desde el POS', desc: 'Tu equipo factura rápido: contado por defecto, o con comprobante fiscal cuando el cliente lo pida.' },
  { n: '03', title: 'Controla todo en el panel', desc: 'Caja, inventario, crédito y reportes en tiempo real — desde cualquier dispositivo.' },
];

export default function HomePage() {
  const { user, logout, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const panelHref =
    !user ? '/login' :
    user.role === 'SUPER_ADMIN' ? '/superadmin' :
    user.role === 'CASHIER' || user.role === 'BILLER' ? '/pos' :
    '/admin';
  const panelLabel = !user ? 'Iniciar Sesión' : 'Ir a mi Panel';

  const onHeroMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(((e.clientX - rect.left) / rect.width - 0.5) * 30);
    mouseY.set(((e.clientY - rect.top) / rect.height - 0.5) * 20);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 font-sans text-slate-100">
      {/* ── Navbar (flotante, glass) ── */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-slate-950/80 backdrop-blur-xl shadow-lg shadow-black/20' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-500/30">
              M
            </span>
            <span className="text-lg font-bold tracking-tight text-white">
              <span className="text-indigo-400">Mini</span>Market OS
            </span>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-slate-300 transition-colors hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            {!loading && user ? (
              <>
                <span className="hidden text-sm text-slate-400 sm:inline">
                  {user.name}
                </span>
                <Link href={panelHref} className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-transform hover:scale-[1.03]">
                  {panelLabel}
                </Link>
                <button onClick={logout} className="rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white">
                  Salir
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white sm:inline-block">
                  Iniciar Sesión
                </Link>
                <Link href="/login?redirect=/pos" className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-transform hover:scale-[1.03]">
                  Acceder al POS
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section
        onMouseMove={onHeroMove}
        className="relative flex min-h-screen items-center overflow-hidden pt-24"
      >
        {/* Fondo: grid de puntos + blobs animados */}
        <div
          className="absolute inset-0 opacity-[0.07] animate-grid-pan"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '28px 28px' }}
        />
        <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl animate-blob" />
        <div className="absolute right-0 top-1/3 h-[28rem] w-[28rem] rounded-full bg-violet-600/20 blur-3xl animate-blob-delay" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl animate-blob-delay-2" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-950" />

        <div className="relative z-10 mx-auto grid max-w-7xl gap-16 px-6 py-16 md:grid-cols-2 md:items-center">
          {/* Texto */}
          <div>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-300"
            >
              🇩🇴 Nacido en RD · Diseñado para escalar a toda Latinoamérica
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-4xl font-black leading-[1.05] tracking-tight text-white md:text-6xl"
            >
              El sistema completo para{' '}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
                vender, facturar y controlar
              </span>{' '}
              tu negocio
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400"
            >
              Punto de venta, inventario, crédito, caja y facturación fiscal (NCF / e-CF) en una
              sola plataforma — online u offline, desde una laptop o una tablet en el mostrador.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-9 flex flex-wrap gap-4"
            >
              <Link
                href={panelHref}
                className="group relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 px-7 py-3.5 text-base font-bold text-white shadow-xl shadow-indigo-500/30 transition-transform hover:scale-[1.03]"
              >
                {!user ? 'Iniciar Sesión' : panelLabel}
              </Link>
              <a
                href="#modulos"
                className="rounded-2xl border border-white/15 bg-white/5 px-7 py-3.5 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                Ver qué hace el sistema ↓
              </a>
            </motion.div>
          </div>

          {/* Mock-up 3D del carrito, con chips flotantes */}
          <div className="relative hidden h-[420px] md:block" style={{ perspective: 1400 }}>
            <ParallaxLayer mouseX={mouseX} mouseY={mouseY} depth={0.6} className="absolute inset-0 flex items-center justify-center">
              <TiltCard className="w-[320px] rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl shadow-black/50 backdrop-blur-xl">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 text-xs font-semibold text-slate-400">Carrito de Venta</span>
                </div>
                <div className="space-y-2.5 p-4">
                  {[
                    { w: '78%', c: 'bg-indigo-400/70' },
                    { w: '60%', c: 'bg-violet-400/70' },
                    { w: '90%', c: 'bg-emerald-400/70' },
                    { w: '45%', c: 'bg-amber-400/60' },
                  ].map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="h-6 flex-1 rounded-md bg-white/5">
                        <div className={`h-full rounded-md ${row.c}`} style={{ width: row.w }} />
                      </div>
                      <span className="w-10 text-right text-[10px] font-mono text-slate-500">RD$</span>
                    </div>
                  ))}
                  <div className="mt-3 flex items-center justify-between rounded-lg bg-gradient-to-r from-indigo-500/20 to-violet-500/20 px-3 py-2.5">
                    <span className="text-xs font-bold text-slate-300">TOTAL</span>
                    <span className="text-sm font-black text-emerald-400">RD$ 1,248.60</span>
                  </div>
                  <div className="rounded-xl bg-emerald-500 py-2.5 text-center text-xs font-bold text-white shadow-lg shadow-emerald-500/30">
                    FINALIZAR VENTA
                  </div>
                </div>
              </TiltCard>
            </ParallaxLayer>

            {[
              { label: '✓ e-CF · DGII', pos: 'left-0 top-4', delay: '0s', color: 'bg-indigo-500' },
              { label: '📡 Offline-ready', pos: 'right-0 top-16', delay: '1.2s', color: 'bg-emerald-500' },
              { label: '🔒 Caja cuadrada', pos: 'left-2 bottom-10', delay: '0.6s', color: 'bg-violet-500' },
              { label: '💳 Crédito activo', pos: 'right-4 bottom-0', delay: '1.8s', color: 'bg-rose-500' },
            ].map((chip) => (
              <ParallaxLayer key={chip.label} mouseX={mouseX} mouseY={mouseY} depth={1.1} className={`absolute ${chip.pos}`}>
                <div
                  className="animate-soft-float rounded-full px-3.5 py-1.5 text-xs font-bold text-white shadow-lg"
                  style={{ animationDelay: chip.delay }}
                >
                  <span className={`rounded-full ${chip.color} px-3.5 py-1.5 shadow-lg`}>{chip.label}</span>
                </div>
              </ParallaxLayer>
            ))}
          </div>
        </div>
      </section>

      {/* ── Marquee de capacidades ── */}
      <section className="relative overflow-hidden border-y border-white/5 bg-slate-900/60 py-5">
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
            <span key={i} className="flex items-center gap-10 text-sm font-semibold text-slate-400">
              {item}
              <span className="text-indigo-500">✦</span>
            </span>
          ))}
        </div>
      </section>

      {/* ── Módulos ── */}
      <section id="modulos" className="bg-slate-950 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-indigo-400">Todo en un solo lugar</p>
            <h2 className="text-3xl font-black text-white md:text-4xl">Todo lo que tu negocio necesita</h2>
            <p className="mt-4 text-slate-400">
              Nueve módulos conectados entre sí — no son pantallas sueltas, es un solo sistema.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 0.08}>
                <TiltCard max={5} className="group h-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 transition-colors hover:border-white/20">
                  <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${f.color} text-2xl shadow-lg`}>
                    {f.icon}
                  </span>
                  <h3 className="text-lg font-bold text-white">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section id="como-funciona" className="bg-slate-900/40 py-24">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="mb-3 text-sm font-bold uppercase tracking-widest text-emerald-400">Simple de verdad</p>
            <h2 className="text-3xl font-black text-white md:text-4xl">Cómo funciona</h2>
          </Reveal>

          <div className="mt-16 grid gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.12} className="relative text-center md:text-left">
                <span className="text-5xl font-black text-white/10">{s.n}</span>
                <h3 className="mt-3 text-xl font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <div className="absolute right-[-20px] top-6 hidden h-px w-10 bg-gradient-to-r from-indigo-500/60 to-transparent md:block" />
                )}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Spotlight: Facturación fiscal ── */}
      <section id="fiscal" className="bg-slate-950 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid items-center gap-16 md:grid-cols-2">
            <Reveal>
              <p className="mb-3 text-sm font-bold uppercase tracking-widest text-indigo-400">Facturación clara</p>
              <h2 className="text-3xl font-black text-white md:text-4xl">
                Comprobantes fiscales sin dolores de cabeza
              </h2>
              <ul className="mt-6 space-y-3">
                {[
                  'Factura de contado por defecto — el comprobante fiscal es una opción aparte, no estorba el día a día',
                  'Al escribir el RNC, el nombre del cliente se autocompleta desde el padrón de la DGII',
                  'e-CF conectado directamente con la DGII: NCF 31, 32 y 45 según el tipo de venta',
                  'Un SuperAdmin centraliza las credenciales fiscales de todos tus comercios',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xs text-emerald-400">✓</span>
                    <span className="text-sm leading-relaxed">{t}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.1}>
              <TiltCard max={6} className="mx-auto w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/40">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Comprobante</span>
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-400">FISCAL</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-slate-500">RNC</span><span className="font-mono text-slate-300">131-xxxxx-x</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-emerald-500/10 px-3 py-2">
                    <span className="text-slate-500">Nombre</span>
                    <span className="flex items-center gap-1 font-semibold text-emerald-400">
                      ✓ Autocompletado
                    </span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-white/5 px-3 py-2">
                    <span className="text-slate-500">e-NCF</span><span className="font-mono text-slate-300">E32-00000421</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-indigo-500/10 px-3 py-2">
                    <span className="text-slate-500">Estado DGII</span><span className="font-bold text-indigo-400">ACEPTADO</span>
                  </div>
                </div>
              </TiltCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Spotlight: Reportes ── */}
      <section className="bg-slate-900/40 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid items-center gap-16 md:grid-cols-2">
            <Reveal delay={0.1} className="order-2 md:order-1">
              <TiltCard max={6} className="mx-auto w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/40">
                <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">Ingresos por categoría</p>
                <div className="flex h-36 items-end gap-3">
                  {[55, 85, 40, 70, 95, 60].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-indigo-600 to-violet-400" style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="mt-4 flex justify-between text-[11px] text-slate-500">
                  <span>Bebidas</span><span>Limpieza</span><span>Víveres</span>
                </div>
              </TiltCard>
            </Reveal>

            <Reveal className="order-1 md:order-2">
              <p className="mb-3 text-sm font-bold uppercase tracking-widest text-violet-400">Decisiones, no adivinanzas</p>
              <h2 className="text-3xl font-black text-white md:text-4xl">
                Reportes que de verdad ayudan a vender más
              </h2>
              <ul className="mt-6 space-y-3">
                {[
                  'Agrupa por producto, categoría, zona, cajero o forma de pago',
                  'Ve ganancia y margen real, no solo ventas brutas',
                  'Exporta a Excel o CSV en un clic para tu contador',
                  'Entradas y salidas de caja reflejadas en el resumen financiero',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs text-violet-400">✓</span>
                    <span className="text-sm leading-relaxed">{t}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Spotlight: Inventario ── */}
      <section className="bg-slate-950 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid items-center gap-16 md:grid-cols-2">
            <Reveal>
              <p className="mb-3 text-sm font-bold uppercase tracking-widest text-amber-400">Migra sin dolor</p>
              <h2 className="text-3xl font-black text-white md:text-4xl">
                Trae tu inventario de donde esté
              </h2>
              <ul className="mt-6 space-y-3">
                {[
                  'Importa desde CSV, Excel o el XPS de tu sistema anterior',
                  'Previsualiza y mapea columnas antes de confirmar nada',
                  'Organiza por zonas: nevera, estante, pasillo…',
                  '¿Inventario pequeño? Muestra fotos. ¿Grande? Usa la tabla compacta',
                ].map((t) => (
                  <li key={t} className="flex items-start gap-3 text-slate-300">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs text-amber-400">✓</span>
                    <span className="text-sm leading-relaxed">{t}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.1}>
              <TiltCard max={6} className="mx-auto w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/40">
                <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-500">Vista de inventario</p>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-lg bg-gradient-to-br from-amber-400/30 to-orange-500/20" />
                  ))}
                </div>
                <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3">
                  {['Nevera · Bebidas', 'Estante A · Limpieza'].map((z) => (
                    <div key={z} className="flex justify-between text-[11px] text-slate-500">
                      <span>{z}</span><span className="font-mono text-slate-400">42 u.</span>
                    </div>
                  ))}
                </div>
              </TiltCard>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="px-6 py-24">
        <Reveal className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-800 p-12 text-center shadow-2xl shadow-indigo-900/40 md:p-16">
          <h2 className="text-3xl font-black text-white md:text-4xl">
            Tu negocio merece un sistema a la altura
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-indigo-100">
            Vende, factura y controla tu inventario desde un solo lugar — nacido en República
            Dominicana, construido para crecer a otros países.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href={panelHref}
              className="rounded-2xl bg-slate-950 px-8 py-3.5 text-base font-bold text-white shadow-xl transition-transform hover:scale-[1.03] hover:bg-slate-900"
            >
              {!user ? 'Iniciar Sesión' : panelLabel}
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 bg-slate-950 py-10">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-black text-white">M</span>
              <span className="text-sm font-bold text-white">MiniMarket OS</span>
            </div>
            <div className="flex gap-6 text-sm text-slate-500">
              <Link href="/pos" className="hover:text-slate-300">POS</Link>
              <Link href="/admin" className="hover:text-slate-300">Admin</Link>
              <Link href="/login" className="hover:text-slate-300">Login</Link>
            </div>
            <p className="text-xs text-slate-600">Nacido en RD 🇩🇴 · Listo para el mundo 🌎</p>
          </div>
          <div className="mt-8 border-t border-white/5 pt-6 text-center text-xs text-slate-600">
            © {new Date().getFullYear()} Ebtech Group Corp. Todos los derechos reservados. MiniMarket OS es un producto de Ebtech Group Corp.
          </div>
        </div>
      </footer>
    </div>
  );
}
