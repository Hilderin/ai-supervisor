import { useEffect, useState } from 'react';
import type { CardState } from '../lib/cardState';
import { cx } from '../lib/cx';
import type { TodoStep } from '../types';
import { ChevronIcon } from './Icons';

interface Props {
  /** la préférence manuelle vit par carte ; session id = clé */
  sessionId: string;
  state: CardState;
  steps: TodoStep[];
  done: number;
  total: number;
}

/**
 * Défaut d'ouverture : déplié quand la tâche travaille ou attend l'humain,
 * replié quand elle a fini de travailler (terminé, ou fini à valider).
 */
export function planDefaultOpen(state: CardState): boolean {
  return state === 'busy' || state === 'waiting';
}

/** Préférence manuelle par carte : le choix de l'utilisateur prime tant que la page vit. */
const manualPref = new Map<string, boolean>();

/** Étapes numérotées avec leur état ; partagées par la bulle (carte) et cette section (détail). */
export function PlanSteps({ steps }: { steps: TodoStep[] }) {
  return (
    <ol className="flex flex-col gap-[5px]">
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
          <span className="mt-[1px] shrink-0 tabular-nums text-muted">{i + 1}.</span>
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
  );
}

/**
 * Section « Plan » du panneau de détail : toujours visible, cliquable sur tout
 * l'en-tête. Le compteur cliquable de la barre de progression est remplacé :
 * le plan vit sous le résumé, la barre de progression reste au-dessous.
 * Ordre affiché dans l'en-tête : titre, nombre d'étapes, badge d'état, chevron.
 */
export function PlanSection({ sessionId, state, steps, done, total }: Props) {
  const [open, setOpen] = useState(
    () => manualPref.get(sessionId) ?? planDefaultOpen(state),
  );

  // Sans préférence manuelle, le défaut suit l'état (une tâche qui se termine
  // se replie). Avec une préférence, elle gagne dans tous les états.
  useEffect(() => {
    if (!manualPref.has(sessionId)) setOpen(planDefaultOpen(state));
  }, [sessionId, state]);

  const toggle = () => {
    const next = !open;
    manualPref.set(sessionId, next);
    setOpen(next);
  };

  const started = done > 0 || steps.some((step) => step.status === 'in_progress');
  const finished = total > 0 && done >= total;
  const count = total || steps.length;
  const countLabel = count > 1 ? `${count} étapes` : count === 1 ? '1 étape' : 'aucune étape';

  return (
    <div
      data-testid="plan-section"
      className="mt-[12px] rounded-[9px] border border-border bg-render px-[12px] py-[10px]"
    >
      <button
        type="button"
        data-testid="plan-header"
        aria-expanded={open}
        aria-label={open ? 'Replier les étapes du plan' : 'Déplier les étapes du plan'}
        onClick={toggle}
        className="flex min-w-0 w-full cursor-pointer items-center gap-[8px] rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-green/40"
      >
        <span className="shrink-0 text-[12px] font-semibold">Plan</span>
        <span className="min-w-0 text-[11px] tabular-nums text-muted">{countLabel}</span>
        <span className="flex-1" />
        {started ? (
          <span
            className={cx(
              'shrink-0 rounded-full px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums',
              finished ? 'bg-green-soft text-green' : 'bg-hover text-muted',
            )}
          >
            {done}/{total}
          </span>
        ) : count > 0 ? (
          <span className="shrink-0 rounded-full bg-hover px-[6px] py-[1px] text-[10.5px] font-semibold text-muted">
            à faire
          </span>
        ) : null}
        <span
          className={cx(
            'mr-[1px] flex shrink-0 text-muted transition-transform',
            open ? '' : '-rotate-90',
          )}
        >
          <ChevronIcon />
        </span>
      </button>
      {open ? (
        <div className="mt-[8px] max-h-[240px] overflow-y-auto" data-testid="plan-steps">
          <PlanSteps steps={steps} />
        </div>
      ) : null}
    </div>
  );
}
