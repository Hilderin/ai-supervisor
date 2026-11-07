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
  return <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full bg-green ring-2 ring-green/25" />;
}
