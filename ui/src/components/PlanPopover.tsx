import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';
import type { TodoStep } from '../types';

interface Props {
  label: string;
  steps: TodoStep[];
  done: number;
  total: number;
}

/** Largeur de la bulle : les étapes longues se replient au lieu d'étirer la carte. */
const WIDTH = 300;
const GAP = 8;
const MARGIN = 8;

/**
 * Compteur d'étapes cliquable. La bulle vit dans un portail en position fixe :
 * laissée dans la carte, elle serait rognée par la zone de défilement et
 * pourrait déborder sous le bord de la fenêtre.
 */
export function PlanPopover({ label, steps, done, total }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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
  }, [open, steps.length]);

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
        data-testid="progress"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Voir les étapes du plan"
        title="Voir les étapes du plan"
        onClick={() => setOpen((v) => !v)}
        className="w-auto min-w-[38px] shrink-0 cursor-pointer whitespace-nowrap rounded-[4px] px-[2px] text-right text-[12px] font-[650] tabular-nums outline-none hover:text-green focus-visible:ring-2 focus-visible:ring-green/40"
      >
        {label}
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label="Étapes du plan"
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="z-[200] rounded-[9px] border border-border bg-card px-[11px] py-[9px] text-left shadow-[0_8px_22px_rgba(0,0,0,.16)]"
            >
              <div className="mb-[6px] flex items-center justify-between gap-[8px]">
                <span className="text-[11.5px] font-semibold">Plan de la tâche</span>
                <span className="text-[11px] tabular-nums text-muted">
                  {done}/{total}
                </span>
              </div>
              <ol className="flex max-h-[240px] flex-col gap-[5px] overflow-y-auto">
                {steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-[7px] text-[12px] leading-[1.35]">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'mt-[1px] w-[11px] shrink-0 text-center',
                        step.status === 'completed'
                          ? 'text-green'
                          : step.status === 'in_progress'
                            ? 'text-amber'
                            : 'text-placeholder',
                      )}
                    >
                      {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '●' : '○'}
                    </span>
                    <span
                      className={cx(
                        'min-w-0',
                        step.status === 'completed' ? 'text-muted line-through' : 'text-text',
                      )}
                    >
                      {step.text}
                    </span>
                  </li>
                ))}
              </ol>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
