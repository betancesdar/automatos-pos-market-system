/**
 * Marca de Automatos: una "A" con un leve guiño al caduceo de Hermes (alas +
 * bastón) — el símbolo mitológico del comercio/mensajería, sin usar su
 * nombre (evita cualquier choque con la marca Hermès). Puramente decorativo.
 */
export function AutomatosMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[58%] w-[58%]" aria-hidden="true">
        {/* Alas */}
        <path d="M12 3c-2.2 1.4-4 1.1-5.4-.2.1 2.3 1.4 3.6 3.6 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
        <path d="M12 3c2.2 1.4 4 1.1 5.4-.2-.1 2.3-1.4 3.6-3.6 4" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
        {/* A estilizada */}
        <path d="M12 5 L18 20 M12 5 L6 20 M8.5 14.5 H15.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
