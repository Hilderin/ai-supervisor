import type { CardState } from '../lib/cardState';

/** Forme + couleur + mouvement : le sens ne repose pas sur la seule couleur. */
export function CardStateIcon({ state }: { state: CardState }) {
  if (state === 'waiting') {
    return <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full bg-orange animate-dot-blink" />;
  }
  if (state === 'busy') {
    return (
      <span
        aria-hidden="true"
        className="h-[12px] w-[12px] shrink-0 rounded-full border-2 border-green border-t-transparent border-r-transparent animate-dot-spin"
      />
    );
  }
  if (state === 'error') {
    return (
      <span aria-hidden="true" className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-danger/10 text-[11px] font-bold leading-none text-danger">
        !
      </span>
    );
  }
  if (state === 'retry') {
    return (
      <span aria-hidden="true" className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-amber/10 text-[11px] font-bold leading-none text-amber">
        ↻
      </span>
    );
  }
  if (state === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] bg-green-soft text-[10px] font-bold leading-none text-green"
      >
        ✓
      </span>
    );
  }
  // « à compléter » : au repos mais travail incomplet (plan ou critères).
  // Triangle d'avertissement orange doux, même empreinte que le sablier,
  // distinct du vert (acquis) et de la pastille orange (question en attente).
  return (
    <span aria-hidden="true" className="flex h-[12px] w-[12px] shrink-0 items-center justify-center text-attend">
      <svg viewBox="0 0 12 11" className="h-[12px] w-[12px]" aria-hidden="true">
        <path
          d="M6 0.6 11.6 10.4H0.4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <rect x="5.4" y="4.1" width="1.2" height="3.4" rx="0.6" fill="currentColor" />
        <circle cx="6" cy="8.9" r="0.7" fill="currentColor" />
      </svg>
    </span>
  );
}
