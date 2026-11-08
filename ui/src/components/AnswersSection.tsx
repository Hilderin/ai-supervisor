import { useEffect, useState } from 'react';
import { ackAnswers, fetchAnswers } from '../lib/api';
import { cx } from '../lib/cx';
import type { TaskAnswer } from '../types';
import { DeliveryMarkdown } from './DeliveryMarkdown';

interface Props {
  sessionId: string;
  /** change avec la dernière activité du tour ET le compteur de la flotte */
  refreshKey: string;
}

const timeLabel = (at: number): string => {
  const d = new Date(at);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(d);
  const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(d);
  const today = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date());
  return day === today ? `${time}` : `${time} · ${day}`;
};

/**
 * Réponses de la tâche au propriétaire (tool `answer`), affichées sous le plan.
 * Les réponses non lues sont visibles avec un bouton « Vu » qui les cache
 * (le compteur de la carte retombe à zéro). Le journal des réponses cachées
 * reste consultable : le bouton « Réponses antérieures » suffit à les rouvrir.
 */
/**
 * Découpe de la liste brute : réponses à lire (read_at absent) et journal des
 * réponses cachées. Exporté pour les tests (le rendu dynamique n'est pas
 * testable en statique).
 */
export function splitAnswers(answers: TaskAnswer[]): { pending: TaskAnswer[]; hidden: TaskAnswer[] } {
  return {
    pending: answers.filter((a) => !a.read_at),
    hidden: answers.filter((a) => !!a.read_at),
  };
}

export function AnswersSection({ sessionId, refreshKey }: Props) {
  const [answers, setAnswers] = useState<TaskAnswer[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showJournal, setShowJournal] = useState(false);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    fetchAnswers(sessionId, ctl.signal)
      .then((list) => { if (alive) setAnswers(list); })
      .catch((e) => {
        if (!alive || (e as Error)?.name === 'AbortError') return;
        // la liste déjà rendue reste à l'écran : une lecture ratée ne la vide pas
      });
    return () => { alive = false; ctl.abort(); };
  }, [sessionId, refreshKey, attempt]);

  // la liste reçue compte les réponses lues plus tôt que la flotte : dériver
  // localement, la friche du compteur se referme au prochain frame SSE
  // pas encore de liste (ou erreur de lecture) : rien à afficher
  if (!answers) return null;
  const { pending, hidden } = splitAnswers(answers);
  const total = pending.length + hidden.length;
  if (total === 0) return null;

  const gotIt = async () => {
    setAcking(true);
    try {
      await ackAnswers(sessionId, pending.map((a) => a.id));
      setAttempt((n) => n + 1);
    } finally {
      setAcking(false);
    }
  };

  return (
    <div data-testid="answers-section" className="mt-[12px] rounded-[9px] border border-border bg-render px-[12px] py-[10px]">
      <div className="flex min-w-0 items-center gap-[8px]">
        <span className="shrink-0 text-[12px] font-semibold">Réponses de l'agent</span>
        {pending.length ? (
          <span
            title="Réponses pas encore marquées comme lues"
            className="shrink-0 rounded-full bg-orange-soft px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums text-attend"
          >
            {pending.length > 1 ? `${pending.length} nouvelles` : '1 nouvelle'}
          </span>
        ) : null}
        <span className="flex-1" />
        {hidden.length ? (
          <button
            type="button"
            data-testid="answers-journal"
            aria-expanded={showJournal}
            onClick={() => setShowJournal((v) => !v)}
            className="cursor-pointer shrink-0 text-[11.5px] font-semibold text-muted hover:text-text hover:underline"
          >
            Réponses antérieures ({hidden.length})
          </button>
        ) : null}
      </div>

      <div data-testid="answers-list" className="mt-[8px] flex flex-col gap-[7px]">
        {!showJournal ? null : (
          <>
            {hidden.map((a) => (
              <AnswerCard key={a.id} sessionId={sessionId} answer={a} hidden />
            ))}
            {pending.length && hidden.length ? <div className="h-px shrink-0 bg-border" role="presentation" /> : null}
          </>
        )}
        {pending.map((a) => (
          <AnswerCard key={a.id} sessionId={sessionId} answer={a} />
        ))}
      </div>

      {pending.length ? (
        <div className="mt-[8px] flex justify-end">
          <button
            type="button"
            data-testid="answers-got-it"
            disabled={acking}
            onClick={() => void gotIt().catch(() => setAttempt((n) => n + 1))}
            className={cx(
              'cursor-pointer rounded-[7px] px-[12px] py-[5px] text-[12px] font-semibold',
              acking ? 'bg-green-soft text-green' : 'bg-green text-white hover:brightness-95',
            )}
          >
            Vu
          </button>
        </div>
      ) : (
        <div className="mt-[6px] text-[11px] text-muted">Toutes les réponses sont lues.</div>
      )}
    </div>
  );
}

function AnswerCard({ sessionId, answer, hidden = false }: { sessionId: string; answer: TaskAnswer; hidden?: boolean }) {
  return (
    <div
      data-testid={hidden ? 'answer-hidden' : 'answer-visible'}
      className={cx(
        'rounded-[7px] border px-[10px] py-[8px]',
        hidden ? 'border-border bg-white/50' : 'border-wait-border bg-white',
      )}
    >
      <div className="mb-[3px] flex min-w-0 items-center gap-[7px] text-[10.5px] text-muted">
        <span className="shrink-0 tabular-nums">{timeLabel(answer.at)}</span>
        {hidden ? <span className="shrink-0 font-semibold">lu</span> : null}
        {answer.question ? (
          <span className="min-w-0 truncate italic" title={answer.question}>
            en réponse à : {answer.question}
          </span>
        ) : null}
      </div>
      <div className="text-[12px] leading-[1.45] text-text">
        <DeliveryMarkdown markdown={answer.text} sessionId={sessionId} />
      </div>
    </div>
  );
}
