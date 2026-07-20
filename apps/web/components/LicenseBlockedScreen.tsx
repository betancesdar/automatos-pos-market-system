'use client';

interface LicenseBlockedScreenProps {
  message: string;
  onLogout: () => Promise<void>;
}

export function LicenseBlockedScreen({ message, onLogout }: LicenseBlockedScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 font-sans">
      <div className="max-w-lg rounded-2xl border border-red-500/30 bg-slate-900 p-10 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-3xl">
          🔒
        </div>
        <h1 className="text-2xl font-bold text-white">Acceso Suspendido</h1>
        <p className="mt-4 text-base leading-relaxed text-slate-400">
          {message ||
            'Su licencia de MiniMarket OS ha expirado o se encuentra suspendida. Contacte al administrador (Darío Betances).'}
        </p>
        <div className="mt-8 space-y-3">
          <a
            href="mailto:dario@minimarket-os.com"
            className="block rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-500"
          >
            Contactar Soporte
          </a>
          <button
            onClick={() => onLogout()}
            className="w-full rounded-xl border border-slate-700 py-3 font-medium text-slate-400 hover:text-white"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    </div>
  );
}
