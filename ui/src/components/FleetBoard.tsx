import { useEffect, useRef, useState } from 'react';
import { cardState } from '../lib/cardState';
import { isWaiting } from '../lib/fleet';
import { sortByOrder } from '../lib/order';
import { cx } from '../lib/cx';
import { isClosedRow, useFleetStore } from '../store/fleetStore';
import type { Fleet } from '../types';
import { SessionCard } from './SessionCard';

interface Props {
  fleet: Fleet | null;
  now: number;
  onOpenChamber: (sessionId: string) => void;
}

/**
 * Une seule liste, dans l'ordre d'arrivée. L'état ne réordonne jamais :
 * l'attention est portée par une barre fixe et par la carte elle-même.
 * Le détail d'une tâche est la colonne de droite (montée par App).
 */
export function FleetBoard({ fleet, now, onOpenChamber }: Props) {
  const closed = useFleetStore((s) => s.closed);
  const placements = useFleetStore((s) => s.placements);
  const order = useFleetStore((s) => s.order);
  const selected = useFleetStore((s) => s.selected);
  const setSelected = useFleetStore((s) => s.setSelected);
  const [flashId, setFlashId] = useState<string | null>(null);
  const nextWaiting = useRef(0);

  const rows = sortByOrder(
    (fleet?.rows ?? []).filter((row) => !isClosedRow(row, closed)),
    order,
  );
  const waiting = rows.filter(isWaiting);
  // Le détail de droite fournit la marge à droite de la liste quand il est ouvert ;
  // fermé, on ajoute cette marge pour que cartes et compteur ne touchent pas le bord.
  const detailOpen = !!selected && rows.some((row) => row.id === selected);

  useEffect(() => {
    if (selected && !rows.some((row) => row.id === selected)) setSelected(null);
  }, [rows, selected, setSelected]);

  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  const showNextWaiting = () => {
    if (!waiting.length) return;
    const target = waiting[nextWaiting.current % waiting.length];
    nextWaiting.current += 1;
    const card = document.querySelector<HTMLElement>(`[data-sid="${target.id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(target.id);
  };

  return (
    <>
      <div
        className={cx(
          'sticky top-0 z-20 -mx-[1px] flex h-[34px] items-center gap-[8px] border-b border-border bg-bg pl-[2px]',
          detailOpen ? 'pr-[2px]' : 'pr-[12px]',
        )}
      >
        {waiting.length ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-orange animate-dot-blink" />
            <span className="shrink-0 text-[12.5px] font-semibold text-attend">
              {waiting.length} en attente
            </span>
            <button
              type="button"
              onClick={showNextWaiting}
              className="h-[22px] shrink-0 cursor-pointer rounded-[6px] border border-wait-border bg-wait px-[8px] text-[11.5px] font-semibold text-attend hover:bg-orange-soft"
            >
              Suivante
            </button>
          </>
        ) : (
          <span className="text-[12.5px] text-muted">Aucune tâche en attente</span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-[11.5px] text-muted">
          {rows.length} tâche{rows.length > 1 ? 's' : ''}
        </span>
      </div>

      <div
        className={cx(
          'flex min-w-0 flex-col gap-[9px] pb-[9px] pl-0 pt-[9px]',
          detailOpen ? '' : 'pr-[12px]',
        )}
      >
        {rows.length ? (
          rows.map((row) => (
            <SessionCard
              key={row.id}
              row={row}
              state={cardState(row, placements[row.id]?.section)}
              selected={selected === row.id}
              flash={flashId === row.id}
              now={now}
              onOpen={() => setSelected(row.id)}
              onOpenChamber={onOpenChamber}
            />
          ))
        ) : (
          <div className="rounded-[9px] border border-border bg-card px-[14px] py-[18px] text-[13px] text-muted">
            Aucune tâche dans la flotte.
          </div>
        )}
      </div>
    </>
  );
}
