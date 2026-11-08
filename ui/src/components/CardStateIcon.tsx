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
  // « fini, à valider » : plus de pastille verte (elle laissait croire que tout
  // était accepté, retour du propriétaire). Étoile à cinq branches, violet doux :
  // accueillante sans être chargée, distincte du vert (acquis) et du orange
  // (question en attente). Étoile charnue : à 10 px, une étoile fine (quatre
  // branches, ou cinq branches trop maigres) s'efface en barre pâle ; constaté
  // au rendu réel. Même empreinte que le sablier, aucun décalage du titre.
  return (
    <span aria-hidden="true" className="flex h-[10px] w-[10px] shrink-0 items-center justify-center text-review">
      <svg viewBox="0 0 10 10" className="h-[10px] w-[10px]" aria-hidden="true">
        <path
          d="M5 0.2 6.59 2.82 9.57 3.52 7.57 5.83 7.82 8.88 5 7.7 2.18 8.88 2.43 5.83 0.43 3.52 3.41 2.82Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
