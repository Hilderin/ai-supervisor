import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchCriteria } from '../lib/api';
import { cx } from '../lib/cx';
import type { Criterion } from '../types';

/** Largeur de la bulle : même gabarit que la bulle du plan. */
const WIDTH = 300;
const GAP = 8;
const MARGIN = 8;

/** Pastille d'état d'un critère, même vocabulaire que les étapes du plan. */
export function criterionMark(status: Criterion['status']): { glyph: string; cls: string } {
  if (status === 'validated') return { glyph: '✓', cls: 'text-green' };
  if (status === 'to_validate') return { glyph: '●', cls: 'text-amber' };
  if (status === 'to_fix') return { glyph: '●', cls: 'text-attend' };
  return { glyph: '○', cls: 'text-placeholder' };
}

/** Lignes de la bulle : une par critère, ref + titre + état. */
export function CriterionRows({ criteria }: { criteria: Criterion[] }) {
  if (!criteria.length) {
    return <div className="text-[11.5px] text-muted">Aucun critère pour l'instant.</div>;
  }
  return (
    <ul className="flex flex-col gap-[5px]">
      {criteria.map((c) => {
        const mark = criterionMark(c.status);
        return (
          <li key={c.id} className="flex items-start gap-[7px] text-[12px] leading-[1.35]">
            <span aria-hidden="true" className={cx('mt-[1px] w-[11px] shrink-0 text-center', mark.cls)}>
              {mark.glyph}
            </span>
            <span className="mt-[1px] shrink-0 font-mono text-[10.5px] font-semibold text-muted">{c.ref}</span>
            <span className={cx('min-w-0', c.status === 'validated' ? 'text-muted' : 'text-text')}>
              {c.title}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface Props {
  sessionId: string;
  label: string;
  done: number;
  total: number;
}

/**
 * Compteur de critères cliquable, même gabarit que PlanPopover : bulle en
 * portail `position:fixed`, sous le compteur, repli au-dessus si elle déborde.
 * La liste ne voyage pas dans la flotte : elle est chargée à l'ouverture de la
 * bulle (la flotte ne transporte que les comptes).
 */
export function CriteriaPopover({ sessionId, label, done, total }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [criteria, setCriteria] = useState<Criterion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // rechargé à chaque ouverture : les états bougent pendant la vie de la carte
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    fetchCriteria(sessionId, ctl.signal)
      .then((r) => {
        setCriteria(r.criteria);
        setError(null);
      })
      .catch((e) => {
        if (String((e as Error)?.name) === 'AbortError') return;
        setError(String((e as Error)?.message ?? e));
      });
    return () => ctl.abort();
  }, [sessionId, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      if (!anchor || !pop) return;
      const left = Math.min(
        Math.max(MARGIN, anchor.right - pop.width),
        window.innerWidth - pop.width - MARGIN,
      );
      let top = anchor.bottom + GAP;
      if (top + pop.height > window.innerHeight - MARGIN) {
        top = Math.max(MARGIN, anchor.top - pop.height - GAP);
      }
      setPos({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, criteria?.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-testid="criteria-progress"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Voir les critères d'acceptation"
        title="Voir les critères d'acceptation"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-auto min-w-[26px] shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] px-[2px] text-right text-[12px] font-[650] tabular-nums outline-none hover:text-green focus-visible:ring-2 focus-visible:ring-green/40"
      >
        {label}
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label="Critères d'acceptation"
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              onClick={(e) => e.stopPropagation()}
              className="z-[200] rounded-[9px] border border-border bg-card px-[11px] py-[9px] text-left shadow-[0_8px_22px_rgba(0,0,0,.16)]"
            >
              <div className="mb-[6px] flex items-center justify-between gap-[8px]">
                <span className="text-[11.5px] font-semibold">Critères d'acceptation</span>
                <span className="text-[11px] tabular-nums text-muted">
                  {done}/{total}
                </span>
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {error ? (
                  <div className="text-[11.5px] text-danger">Critères indisponibles : {error}</div>
                ) : criteria ? (
                  <CriterionRows criteria={criteria} />
                ) : (
                  <div className="text-[11.5px] text-muted">Chargement…</div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
