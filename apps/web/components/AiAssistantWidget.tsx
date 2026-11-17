'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { apiFetch } from '../lib/api';

interface Msg { role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  '¿Cuánto vendí este mes?',
  '¿Cuánto le debo a mis proveedores?',
  '¿Cuánto me deben los clientes?',
  '¿Cuál fue mi utilidad este mes?',
  '¿Qué productos están por agotarse?',
];

export function AiAssistantWidget() {
  const { user, can } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const allowed = can?.('ai.chat') ?? false;

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  if (!allowed) return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = msgs.slice(-6);
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    setUnavailable(false);
    try {
      const res = await apiFetch<{ reply: string; available: boolean }>('/ai-assistant/chat', tenantId, {
        method: 'POST',
        body: JSON.stringify({ message, history }),
      });
      setMsgs((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/disponible|configurado|503/i.test(msg)) {
        setUnavailable(true);
        setMsgs((m) => [...m, { role: 'assistant', content: 'El asistente no está disponible ahora mismo. Intenta más tarde.' }]);
      } else {
        setMsgs((m) => [...m, { role: 'assistant', content: 'Hubo un error procesando tu pregunta. Intenta de nuevo.' }]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-2xl text-white shadow-lg shadow-indigo-500/40 transition-transform hover:scale-105"
          aria-label="Asistente IA"
        >
          ✨
        </button>
      )}

      {/* Panel de chat */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] flex h-[560px] max-h-[85vh] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <div>
                <p className="text-sm font-bold leading-none">Automatos AI</p>
                <p className="text-[11px] text-indigo-100">Tu asistente del negocio</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white">✕</button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Hola 👋 Pregúntame sobre tus ventas, inventario, cuentas por cobrar/pagar o contabilidad.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-600 hover:border-indigo-300 hover:bg-indigo-50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-700'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400">
                  Pensando… <span className="animate-pulse">●●●</span>
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white p-3">
            {unavailable && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                ⚠️ El asistente está fuera de línea. El resto del sistema funciona normal.
              </p>
            )}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Escribe tu pregunta…"
                disabled={busy}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 disabled:opacity-60"
              />
              <button onClick={() => send(input)} disabled={busy || !input.trim()}
                className="rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                ➤
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              Las cifras salen directo de tu sistema — el asistente no las inventa.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
