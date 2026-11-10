import { useEffect, useRef, useState } from 'react';
import { fetchFleet, replyPermission, setSupervision } from '../lib/api';
import type { CardState } from '../lib/cardState';
import { cardStateLabel } from '../lib/cardState';
import { closeQuestionOf, closeTask } from '../lib/closeTask';
import { cx } from '../lib/cx';
import { briefRow, dirName } from '../lib/fleet';
import { isUnsupervised, supervisionActionLabel } from '../lib/supervision';
import { BTN_GHOST, BTN_PRIMARY } from '../lib/ui';
import { useFleetStore } from '../store/fleetStore';
import { useTaskModel } from '../hooks/useTaskModel';
import type { FleetRow } from '../types';
import { ActivityLine } from './ActivityLine';
import { CardStateIcon } from './CardStateIcon';
import { Composer } from './Composer';
import { AnswersSection } from './AnswersSection';
import { CriteriaSection } from './CriteriaSection';
import { DeliveryBlock } from './DeliveryBlock';
import { OpenChamberIcon, QuestionIcon, SupervisionIcon, SupervisionOffIcon } from './Icons';
import { PlanSection } from './PlanSection';
import { QuestionBox } from './QuestionBox';
import { TaskModelPopover, taskModelLabel } from './TaskModelPopover';

interface Props {
  row: FleetRow;
  state: CardState;
  now: number;
  onClose: () => void;
  onOpenChamber: (sessionId: string) => void;
}

/**
 * Détail d'une tâche : colonne à droite, redimensionnable depuis App.
 * Le corps défile ; le composer reste collé en bas, comme un chat.
 * La fermeture du panneau et la clôture de la tâche sont deux gestes distincts.
 */
export function TaskInspector({ row, state, now, onClose, onOpenChamber }: Props) {
  const closeSession = useFleetStore((s) => s.closeSession);
  const [actionError, setActionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const waiting = state === 'waiting';
  const done = state === 'done';
  const form = row.pendingForms?.[0];
  const perm = row.pendingPermissions?.[0];
  const waitingKind = form ? 'form' : perm ? 'permission' : undefined;
  const stateLabel = cardStateLabel(state, waitingKind);
  // même ligne que la carte, en haut du panneau ; rien au repos
  const activity = state === 'busy' ? row.activity : undefined;
  const brief = row.sup?.resume || briefRow(row, waiting, now);
  const attend = row.sup?.attend && (waiting || row.sup?.humanSource === 'agent_ask')
    ? row.sup.attend
    : '';
  const dir = dirName(row.dir);

  // supervision opt-in : badge dans la ligne d'état et bascule dans l'en-tête,
  // même endpoint que la carte ; le frame SSE suivant porte le nouvel état
  const unsupervised = isUnsupervised(row);
  const supervisionLabel = supervisionActionLabel(row);
  const toggleSupervision = async () => {
    setActionError(null);
    try {
      await setSupervision(row.id, unsupervised);
      void fetchFleet().catch(() => undefined);
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    }
  };

  const planSteps = row.plan?.steps ?? [];
  const progress = row.sup?.progress != null ? Math.max(0, Math.min(100, Number(row.sup.progress))) : null;
  const { info: taskModel, loading: taskModelLoading, error: taskModelError, setInfo: setTaskModel } = useTaskModel(row.id);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    // Une question : le curseur va dans le premier champ. Sinon le panneau prend
    // le focus clavier sans faire défiler jusqu'au composer.
    const first = waiting
      ? panelRef.current?.querySelector<HTMLElement>('input, textarea') ?? panelRef.current
      : panelRef.current;
    first?.focus();
  }, [row.id, waiting]);

  const close = async () => {
    const question = closeQuestionOf(row);
    if (question && !window.confirm(`Cette tâche attend encore « ${question} ». La fermer abandonne la demande. Fermer quand même ?`)) return;
    setActionError(null);
    try {
      await closeTask(row, closeSession, !!question);
      // la tâche quittée, la sélection a déjà glissé vers sa voisine : le
      // panneau reste ouvert. On ne le referme que si la clôture n'a pas été
      // retenue par la flotte (la tâche est toujours sélectionnée).
      if (useFleetStore.getState().selected === row.id) onCloseRef.current();
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <div
      ref={panelRef}
      role="group"
      aria-label={`Détail de ${row.title}`}
      tabIndex={-1}
      className="flex h-full min-h-0 w-full flex-col bg-card outline-none"
    >
      <header className="flex shrink-0 items-center gap-[9px] border-b border-border px-[14px] py-[10px]">
        <CardStateIcon state={state} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-[650]" title={row.title}>
          {row.title}
        </span>
        <TaskModelPopover
          sessionId={row.id}
          info={taskModel}
          loading={taskModelLoading}
          error={taskModelError}
          onSaved={setTaskModel}
        />
        <button
          type="button"
          data-testid="inspector-supervision-toggle"
          aria-label={supervisionLabel}
          title={unsupervised
            ? 'Activer la supervision (compagnon + vérificateur sur cette conversation)'
            : 'Désactiver la supervision (les sous-agents sont détachés)'}
          onClick={() => void toggleSupervision()}
          className={cx(
            'flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent',
            unsupervised ? 'text-muted hover:bg-hover hover:text-text' : 'text-green hover:bg-green-soft',
          )}
        >
          <SupervisionIcon />
        </button>
        <button
          type="button"
          title="Ouvrir dans le mini chat OpenChamber"
          onClick={() => onOpenChamber(row.id)}
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green"
        >
          <OpenChamberIcon />
        </button>
        <button
          type="button"
          title="Fermer le détail"
          aria-label="Fermer le détail"
          onClick={onClose}
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
        >
          ×
        </button>
      </header>

      <div className="flex shrink-0 flex-col gap-[7px] border-b border-border px-[14px] pb-[9px] pt-[8px]">
        <div className="flex min-w-0 items-center gap-[8px] text-[11.5px]">
          <span className={cx('shrink-0 font-semibold', waiting ? 'text-attend' : 'text-muted')}>
            {stateLabel}
          </span>
          {unsupervised ? (
            <span
              data-testid="inspector-unsupervised"
              title="Conversation non supervisée : ni compagnon ni vérificateur ; les messages partent sans habillage du superviseur."
              className="flex shrink-0 items-center gap-[4px] rounded-full border border-border px-[7px] py-[1px] text-[10px] font-semibold text-muted"
            >
              <SupervisionOffIcon />
              Non supervisée
            </span>
          ) : null}
          {dir ? <span className="min-w-0 truncate text-muted" title={row.dir}>{dir}</span> : null}
          <span className="flex-1" />
          <span
            data-testid="task-model"
            title={taskModel?.name ?? 'défaut de la session'}
            className="max-w-[46%] shrink-0 truncate text-muted"
          >
            {taskModelLabel(taskModel, taskModelLoading, taskModelError)}
          </span>
        </div>
        {activity ? <ActivityLine activity={activity} /> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pb-[12px] pt-[10px]">
        {row.issue ? (
          <div
            role="status"
            data-testid="session-issue"
            className={cx(
              'mb-[10px] rounded-[9px] border px-[12px] py-[9px] text-[12.5px]',
              row.issue.state === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-amber/30 bg-amber/10 text-text',
            )}
          >
            <div className="font-semibold">
              {row.issue.state === 'error' ? 'Échec OpenCode' : `Nouvelle tentative OpenCode${row.issue.attempt ? ` · tentative ${row.issue.attempt}` : ''}`}
            </div>
            {row.issue.message ? <div className="mt-[3px] whitespace-pre-wrap">{row.issue.message}</div> : null}
            {row.issue.errorType || row.issue.errorStatus ? (
              <div className="mt-[3px] text-[11px] opacity-80">
                {[row.issue.errorType, row.issue.errorStatus ? `HTTP ${row.issue.errorStatus}` : ''].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-[9px] border border-border bg-render px-[12px] py-[10px]">
          <div className="mb-[6px] text-[12px] font-semibold text-muted">Résumé</div>
          <div className="whitespace-pre-wrap text-[13.5px] leading-[1.45] text-text">{brief}</div>
        </div>
        {attend ? (
          <div className="mt-[4px] text-[13px] text-attend">
            <QuestionIcon /> {attend}
          </div>
        ) : null}

        {planSteps.length ? (
          <PlanSection
            sessionId={row.id}
            state={state}
            steps={planSteps}
            done={row.plan?.done ?? 0}
            total={row.plan?.total ?? 0}
          />
        ) : (
          <div className="mt-[12px] text-[11.5px] text-muted">
            {progress != null ? `${Math.round(progress)} %` : 'pas de plan'}
          </div>
        )}

        {row.criteria?.total ? (
          <CriteriaSection
            sessionId={row.id}
            state={state}
            refreshKey={`${row.lastUpdateAt ?? 0}:${row.turnStartedAt ?? 0}`}
            counts={row.criteria}
          />
        ) : null}

        <AnswersSection
          sessionId={row.id}
          refreshKey={`${row.lastUpdateAt ?? 0}:${row.unreadAnswers ?? 0}`}
        />

        <DeliveryBlock
          sessionId={row.id}
          enabled={state === 'done' || state === 'idle'}
          done={done}
          defaultExpanded
          refreshKey={`${row.lastUpdateAt ?? 0}:${row.turnStartedAt ?? 0}`}
        />

        {perm ? (
          <div className="mt-[12px] border-t border-border pt-[10px]">
            <div className="mb-[8px] text-[14px] leading-[1.45]">Permission demandée</div>
            <button
              type="button"
              onClick={() =>
                void replyPermission(row.id, String(perm.id ?? ''), 'once').catch((e) =>
                  setActionError(String((e as Error)?.message ?? e)),
                )
              }
              className={BTN_PRIMARY}
            >
              Autoriser
            </button>
          </div>
        ) : form ? (
          // même gabarit que les autres sections du détail (encadré, titre),
          // avec le « ? » et le orange de la carte pour la question en attente
          <section
            data-testid="question-section"
            className="mt-[12px] rounded-[9px] border border-wait-border bg-wait px-[12px] py-[10px]"
          >
            <div className="flex min-w-0 items-center gap-[7px]">
              <QuestionIcon />
              <span className="shrink-0 text-[12px] font-semibold text-attend">Question en attente</span>
              {form.title ? (
                <span className="min-w-0 truncate text-[11.5px] text-muted" title={form.title}>
                  {form.title}
                </span>
              ) : null}
              <span className="flex-1" />
            </div>
            <QuestionBox key={form.id} sessionId={row.id} form={form} embedded />
          </section>
        ) : null}

        {actionError ? <div className="mt-[8px] text-[11.5px] text-danger">{actionError}</div> : null}
      </div>

      <div className="shrink-0 pb-[10px] pl-[14px] pr-[14px]">
        <Composer sessionId={row.id} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-[8px] border-t border-border px-[14px] py-[9px]">
        {state !== 'busy' && state !== 'retry' ? (
          <button
            type="button"
            title="Retirer la tâche de la flotte"
            onClick={() => void close()}
            className={BTN_PRIMARY}
          >
            Terminé
          </button>
        ) : null}
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Fermer le détail
        </button>
      </div>
    </div>
  );
}
