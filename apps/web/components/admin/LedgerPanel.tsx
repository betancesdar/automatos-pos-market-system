'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

interface Account { id: string; code: string; name: string; type: string; active: boolean }
interface JournalLineView { id: string; debit: string; credit: string; account: { code: string; name: string; type: string } }
interface JournalEntryView { id: string; date: string; memo: string | null; sourceType: string; lines: JournalLineView[] }
interface LedgerRow { entryId: string; date: string; memo: string | null; sourceType: string; debit: string; credit: string; balance: string }
interface IncomeStatement { income: { code: string; name: string; amount: string }[]; expense: { code: string; name: string; amount: string }[]; totalIncome: string; totalExpense: string; netIncome: string }
interface BalanceSheet { assets: { code: string; name: string; amount: string }[]; liabilities: { code: string; name: string; amount: string }[]; equity: { code: string; name: string; amount: string }[]; totalAssets: string; totalLiabilities: string; totalEquity: string; balanced: boolean }

type Sub = 'accounts' | 'journal' | 'ledger' | 'statements';

const TYPE_LABEL: Record<string, string> = { ASSET: 'Activo', LIABILITY: 'Pasivo', EQUITY: 'Capital', INCOME: 'Ingreso', EXPENSE: 'Gasto' };
const SOURCE_LABEL: Record<string, string> = { SALE: 'Venta', PURCHASE: 'Compra', CREDIT_PAYMENT: 'Abono', SUPPLIER_PAYMENT: 'Pago prov.', CASH: 'Caja', MANUAL: 'Manual' };
const money = (n: string | number) => `RD$ ${Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

export function LedgerPanel({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const [sub, setSub] = useState<Sub>('journal');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAccounts = useCallback(async () => {
    try { setAccounts(await apiFetch<Account[]>('/accounting/accounts', tenantId)); } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }, [tenantId]);
  useEffect(() => { if (tenantId) loadAccounts(); }, [tenantId, loadAccounts]);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}

      <div className="flex flex-wrap gap-2">
        {([['journal', '📓 Libro Diario'], ['ledger', '📗 Libro Mayor'], ['statements', '📊 Estados Financieros'], ['accounts', '🗂️ Catálogo de Cuentas']] as [Sub, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${sub === k ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {sub === 'accounts' && <AccountsTab tenantId={tenantId} canManage={canManage} accounts={accounts} reload={loadAccounts} setError={setError} flash={flash} />}
      {sub === 'journal' && <JournalTab tenantId={tenantId} canManage={canManage} accounts={accounts} busy={busy} setBusy={setBusy} setError={setError} flash={flash} />}
      {sub === 'ledger' && <LedgerTab tenantId={tenantId} accounts={accounts} setError={setError} />}
      {sub === 'statements' && <StatementsTab tenantId={tenantId} setError={setError} />}
    </div>
  );
}

function AccountsTab({ tenantId, canManage, accounts, reload, setError, flash }: {
  tenantId: string; canManage: boolean; accounts: Account[]; reload: () => void; setError: (s: string) => void; flash: (m: string) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('ASSET');
  const [show, setShow] = useState(false);

  const create = async () => {
    if (!code.trim() || !name.trim()) { setError('Código y nombre son obligatorios'); return; }
    try {
      await apiFetch('/accounting/accounts', tenantId, { method: 'POST', body: JSON.stringify({ code, name, type }) });
      setCode(''); setName(''); setShow(false); flash('Cuenta creada'); reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  };

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <button onClick={() => setShow((v) => !v)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            {show ? 'Cerrar' : '+ Nueva cuenta'}
          </button>
        </div>
      )}
      {show && (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código (ej. 1101)" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre de la cuenta" className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <div className="sm:col-span-4 flex justify-end"><button onClick={create} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500">Crear cuenta</button></div>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Código</th><th className="px-4 py-3">Cuenta</th><th className="px-4 py-3">Tipo</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-slate-100">
                <td className="px-4 py-2.5 font-mono text-slate-700">{a.code}</td>
                <td className="px-4 py-2.5 text-slate-700">{a.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{TYPE_LABEL[a.type]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">El catálogo base se crea automáticamente la primera vez. Puedes agregar cuentas propias o importar desde otro sistema.</p>
    </div>
  );
}

function JournalTab({ tenantId, canManage, accounts, busy, setBusy, setError, flash }: {
  tenantId: string; canManage: boolean; accounts: Account[]; busy: boolean; setBusy: (b: boolean) => void; setError: (s: string) => void; flash: (m: string) => void;
}) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<{ accountId: string; debit: string; credit: string }[]>([{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }]);

  const load = useCallback(async () => {
    try { setEntries(await apiFetch<JournalEntryView[]>(`/accounting/journal?from=${from}&to=${to}`, tenantId)); } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }, [tenantId, from, to, setError]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) { d += parseFloat(l.debit) || 0; c += parseFloat(l.credit) || 0; }
    return { d, c, balanced: Math.abs(d - c) < 0.005 && d > 0 };
  }, [lines]);

  const sync = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch<{ salesPosted: number; purchasesPosted: number; paymentsPosted: number }>('/accounting/journal/sync', tenantId, { method: 'POST', body: JSON.stringify({ from, to }) });
      flash(`Asientos generados: ${r.salesPosted} ventas, ${r.purchasesPosted} compras, ${r.paymentsPosted} pagos`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  };

  const saveEntry = async () => {
    const valid = lines.filter((l) => l.accountId && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));
    if (valid.length < 2) { setError('El asiento necesita al menos 2 líneas'); return; }
    if (!totals.balanced) { setError('El asiento no cuadra (débitos ≠ créditos)'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch('/accounting/journal', tenantId, { method: 'POST', body: JSON.stringify({ date, memo, lines: valid.map((l) => ({ accountId: l.accountId, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })) }) });
      setShowNew(false); setMemo(''); setLines([{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }]); flash('Asiento registrado'); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  };

  const setLine = (i: number, patch: Partial<{ accountId: string; debit: string; credit: string }>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Hasta</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        {canManage && (
          <>
            <button onClick={sync} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {busy ? '…' : '⚙️ Generar asientos (ventas/compras)'}
            </button>
            <button onClick={() => setShowNew((v) => !v)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">{showNew ? 'Cerrar' : '+ Asiento manual'}</button>
          </>
        )}
      </div>

      {showNew && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Fecha</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="flex-1 text-sm"><span className="mb-1 block text-xs text-slate-500">Descripción</span><input value={memo} onChange={(e) => setMemo(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Concepto del asiento" /></label>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Cuenta</th><th className="py-1 text-right">Débito</th><th className="py-1 text-right">Crédito</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select value={l.accountId} onChange={(e) => setLine(i, { accountId: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm">
                      <option value="">— Cuenta —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  </td>
                  <td className="py-1"><input type="number" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm" /></td>
                  <td className="py-1 pl-2"><input type="number" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between">
            <button onClick={() => setLines((ls) => [...ls, { accountId: '', debit: '', credit: '' }])} className="text-sm font-medium text-indigo-600">+ Agregar línea</button>
            <div className={`text-sm font-semibold ${totals.balanced ? 'text-emerald-600' : 'text-rose-600'}`}>
              Débitos {money(totals.d)} · Créditos {money(totals.c)} {totals.balanced ? '✓' : '✗'}
            </div>
          </div>
          <div className="flex justify-end"><button onClick={saveEntry} disabled={busy || !totals.balanced} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">Registrar asiento</button></div>
        </div>
      )}

      <div className="space-y-3">
        {entries.length === 0 ? (
          <p className="py-10 text-center text-slate-400">Sin asientos en este rango. Usa «Generar asientos» para contabilizar ventas y compras.</p>
        ) : entries.map((e) => (
          <div key={e.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-sm">
              <span className="font-semibold text-slate-700">{new Date(e.date).toLocaleDateString('es-DO')} · {e.memo || 'Asiento'}</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">{SOURCE_LABEL[e.sourceType] || e.sourceType}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-4 py-1.5 text-slate-600"><span className="font-mono text-xs text-slate-400">{l.account.code}</span> {l.account.name}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">{Number(l.debit) > 0 ? money(l.debit) : ''}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">{Number(l.credit) > 0 ? money(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerTab({ tenantId, accounts, setError }: { tenantId: string; accounts: Account[]; setError: (s: string) => void }) {
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<{ account: Account; rows: LedgerRow[]; balance: string } | null>(null);

  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  useEffect(() => {
    if (!accountId) return;
    apiFetch<{ account: Account; rows: LedgerRow[]; balance: string }>(`/accounting/ledger/${accountId}?from=${from}&to=${to}`, tenantId)
      .then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Error'));
  }, [tenantId, accountId, from, to, setError]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Cuenta</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Hasta</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500"><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Concepto</th><th className="px-4 py-3 text-right">Débito</th><th className="px-4 py-3 text-right">Crédito</th><th className="px-4 py-3 text-right">Saldo</th></tr></thead>
          <tbody>
            {!data || data.rows.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">Sin movimientos en este rango.</td></tr>
            ) : data.rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="px-4 py-2 text-slate-500">{new Date(r.date).toLocaleDateString('es-DO')}</td>
                <td className="px-4 py-2 text-slate-600">{r.memo || SOURCE_LABEL[r.sourceType] || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(r.debit) > 0 ? money(r.debit) : ''}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(r.credit) > 0 ? money(r.credit) : ''}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          {data && <tfoot><tr className="bg-slate-50 font-bold"><td colSpan={4} className="px-4 py-2 text-right">Saldo final</td><td className="px-4 py-2 text-right tabular-nums">{money(data.balance)}</td></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

function StatementsTab({ tenantId, setError }: { tenantId: string; setError: (s: string) => void }) {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [is, setIs] = useState<IncomeStatement | null>(null);
  const [bs, setBs] = useState<BalanceSheet | null>(null);

  useEffect(() => {
    apiFetch<IncomeStatement>(`/accounting/reports/income-statement?from=${from}&to=${to}`, tenantId).then(setIs).catch((e) => setError(e instanceof Error ? e.message : 'Error'));
    apiFetch<BalanceSheet>(`/accounting/reports/balance-sheet?asOf=${to}`, tenantId).then(setBs).catch((e) => setError(e instanceof Error ? e.message : 'Error'));
  }, [tenantId, from, to, setError]);

  const Row = ({ code, name, amount }: { code: string; name: string; amount: string }) => (
    <div className="flex justify-between py-1 text-sm"><span className="text-slate-600"><span className="font-mono text-xs text-slate-400">{code}</span> {name}</span><span className="tabular-nums text-slate-700">{money(amount)}</span></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Desde</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-slate-500">Hasta / Al corte</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-base font-bold text-slate-900">Estado de Resultados</h3>
          {is && (
            <>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Ingresos</p>
              {is.income.length ? is.income.map((r) => <Row key={r.code} {...r} />) : <p className="text-sm text-slate-400">—</p>}
              <div className="my-1 flex justify-between border-t border-slate-100 pt-1 text-sm font-semibold"><span>Total ingresos</span><span className="tabular-nums">{money(is.totalIncome)}</span></div>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-400">Gastos</p>
              {is.expense.length ? is.expense.map((r) => <Row key={r.code} {...r} />) : <p className="text-sm text-slate-400">—</p>}
              <div className="my-1 flex justify-between border-t border-slate-100 pt-1 text-sm font-semibold"><span>Total gastos</span><span className="tabular-nums">{money(is.totalExpense)}</span></div>
              <div className={`mt-3 flex justify-between rounded-lg px-3 py-2 text-base font-bold ${Number(is.netIncome) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <span>Utilidad neta</span><span className="tabular-nums">{money(is.netIncome)}</span>
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 text-base font-bold text-slate-900">Balance General</h3>
          {bs && (
            <>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Activos</p>
              {bs.assets.map((r) => <Row key={r.code} {...r} />)}
              <div className="my-1 flex justify-between border-t border-slate-100 pt-1 text-sm font-semibold"><span>Total activos</span><span className="tabular-nums">{money(bs.totalAssets)}</span></div>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-400">Pasivos</p>
              {bs.liabilities.map((r) => <Row key={r.code} {...r} />)}
              <div className="my-1 flex justify-between border-t border-slate-100 pt-1 text-sm font-semibold"><span>Total pasivos</span><span className="tabular-nums">{money(bs.totalLiabilities)}</span></div>
              <p className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-400">Patrimonio</p>
              {bs.equity.map((r) => <Row key={r.code} {...r} />)}
              <div className="my-1 flex justify-between border-t border-slate-100 pt-1 text-sm font-semibold"><span>Total patrimonio</span><span className="tabular-nums">{money(bs.totalEquity)}</span></div>
              <div className={`mt-3 rounded-lg px-3 py-2 text-center text-xs font-semibold ${bs.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {bs.balanced ? '✓ El balance cuadra (Activos = Pasivos + Patrimonio)' : '⚠️ El balance no cuadra — revisa los asientos'}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
