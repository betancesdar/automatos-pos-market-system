'use client';

import { useState } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { AdminShell } from '../../../components/admin/AdminShell';
import { TenantSettingsPanel } from '../../../components/admin/TenantSettingsPanel';
import { ReceiptSettingsPanel } from '../../../components/admin/ReceiptSettingsPanel';
import { EmployeesPanel } from '../../../components/admin/EmployeesPanel';

type SettingsTab = 'general' | 'receipt' | 'users';

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: '🏪' },
  { id: 'receipt', label: 'Recibos / Impresora', icon: '🧾' },
  { id: 'users', label: 'Usuarios', icon: '👥' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <AdminShell title="Configuración" subtitle="Datos del negocio, recibos térmicos y usuarios">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <section>
          <h3 className="mb-4 text-lg font-bold text-slate-900">Datos del Negocio & NCF</h3>
          <TenantSettingsPanel tenantId={tenantId} />
        </section>
      )}

      {tab === 'receipt' && (
        <section>
          <h3 className="mb-4 text-lg font-bold text-slate-900">Recibo Térmico & Impresora</h3>
          <ReceiptSettingsPanel tenantId={tenantId} />
        </section>
      )}

      {tab === 'users' && (
        <section>
          <h3 className="mb-4 text-lg font-bold text-slate-900">Gestión de Usuarios</h3>
          <EmployeesPanel tenantId={tenantId} />
        </section>
      )}
    </AdminShell>
  );
}
