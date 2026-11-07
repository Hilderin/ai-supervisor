import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardState } from '../lib/cardState';
import { cardStateLabel } from '../lib/cardState';
import { closeQuestionOf, closeTask } from '../lib/closeTask';
import { cx } from '../lib/cx';
import { BUSY_BRIEF, briefRow, isStaleTurn, planLabel } from '../lib/fleet';
import { useFleetStore } from '../store/fleetStore';
import type { FleetRow } from '../types';
import { CardStateIcon } from './CardStateIcon';
import { Composer } from './Composer';
import { ConfidenceDots } from './ConfidenceDots';
import { DeliveryBlock } from './DeliveryBlock';
import { CloseConversationIcon, OpenChamberIcon } from './Icons';
import { PlanPopover } from './PlanPopover';

interface Props {
  row: FleetRow;
  state: CardState;
  selected: boolean;
  flash: boolean;
  now: number;
  onOpen: () => void;
}

const CARD_BTN =
  'flex h-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] px-[9px] text-[11.5px] font-semibold';

/**
 * Carte à hauteur fixe. Toutes les zones sont réservées dans tous les états :
 * l'état ne change que l'icône, le contenu interne et l'action du pied.
 */
export function SessionCard({ row, state, selected, flash, now, onOpen }: Props) {
  const closeSession = useFleetStore((s) => s.closeSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const waiting = state === 'waiting';
  const done = state === 'done';
  const busy = state === 'busy';
  const stale = isStaleTurn(row);
  const brief = stale ? BUSY_BRIEF : row.sup?.resume || briefRow(row, waiting, now);
  const form = row.pendingForms?.[0];
  const perm = row.pendingPermissions?.[0];
  const waitingKind = form ? 'form' : perm ? 'permission' : undefined;
  const stateLabel = cardStateLabel(state, waitingKind);

  const hasProgress = row.sup?.progress != null || !!row.todo;
  const progress = row.sup?.progress != null ? Math.max(0, Math.min(100, Number(row.sup.progress))) : 0;
  const todoSteps = row.todo?.steps ?? [];
  const progressLabel = planLabel(row.todo, done, progress);
  const rawConf = row.sup?.confiance;
  const conf = rawConf == null ? null : Math.max(0, Math.min(1, rawConf));
  const attend = row.sup?.attend && (waiting || row.sup.humanSource === 'agent_ask') ? row.sup.attend : '';
  const currentStep =
    row.todo?.steps?.find((step) => step.status === 'in_progress') ??
    row.todo?.steps?.find((step) => step.status === 'pending');
  const questionText = form
    ? (form.fields?.[0]?.description ?? form.fields?.[0]?.title ?? form.title ?? 'question en attente')
    : perm
      ? 'Permission demandée'
      : '';

  const close = async () => {
    setMenuOpen(false);
    const question = closeQuestionOf(row);
    if (question && !window.confirm(`Cette tâche attend encore « ${question} ». La fermer abandonne la demande. Fermer quand même ?`)) return;
    setCloseError(null);
    try {
      await closeTask(row, closeSession, !!question);
    } catch (e) {
      setCloseError(String((e as Error)?.message ?? e));
    }
  };

  // Le menu vit en portail : la carte est en overflow:hidden et ne doit pas le rogner.
  useEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const rect = kebabRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 230;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      let top = rect.bottom + 4;
      if (top + 60 > window.innerHeight - 8) top = Math.max(8, rect.top - 60);
      setMenuPos({ top, left });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || kebabRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const action =
    state === 'waiting'
      ? { label: 'Répondre', primary: true, run: onOpen }
      : state === 'busy'
        ? { label: 'Détail', primary: false, run: onOpen }
        : { label: 'Terminé', primary: true, run: () => void close() };

  let detail: ReactNode = null;
  if (state === 'waiting') {
    detail = <span className="text-attend">✋ {questionText}</span>;
  } else if (busy) {
    detail = currentStep ? (
      <span>Étape : {currentStep.text}</span>
    ) : attend ? (
      <span className="text-attend">✋ {attend}</span>
    ) : null;
  } else if (state === 'idle' && attend) {
    detail = <span className="text-attend">✋ {attend}</span>;
  } else {
    detail = (
      <DeliveryBlock
        sessionId={row.id}
        enabled
        done={done}
        compact
        refreshKey={`${row.lastUpdateAt ?? 0}:${row.turnStartedAt ?? 0}`}
      />
    );
  }

  return (
    <div
      data-sid={row.id}
      role="group"
      aria-label={`${row.title}, ${stateLabel}`}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cx(
        'relative grid h-[232px] w-full min-w-0 cursor-pointer grid-cols-1 grid-rows-[24px_minmax(0,1fr)_34px_30px] gap-[8px] overflow-hidden rounded-[11px] border px-[13px] pb-[10px] pt-[11px] outline-none',
        waiting ? 'border-wait-border border-l-[3px] border-l-orange bg-wait' : 'border-border bg-card',
        flash ? 'ring-2 ring-inset ring-orange/60' : selected ? 'ring-2 ring-inset ring-green/40' : '',
      )}
    >
      <div className="flex h-[24px] items-center gap-[8px]">
        <CardStateIcon state={state} />
        <span
          className="min-w-0 flex-1 truncate font-[650]"
          title={row.dir ? `${row.title} · ${row.dir}` : row.title}
        >
          {row.title}
        </span>
        {waiting ? (
          <span
            title={stateLabel}
            className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full bg-orange text-[10px] font-bold text-white"
          >
            {form ? '?' : '!'}
          </span>
        ) : null}
        <button
          ref={kebabRef}
          type="button"
          title="Options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-[14px] tracking-[1px] text-muted hover:bg-hover hover:text-text"
        >
          ⋯
        </button>
        <button
          type="button"
          title="Ouvrir dans OpenChamber"
          onClick={(e) => {
            e.stopPropagation();
            window.open(`openchamber-ui://session/${row.id}`);
          }}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green"
        >
          <OpenChamberIcon />
        </button>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden">
        <div className="line-clamp-2 pb-[2px] text-[13.5px] leading-[1.45] text-muted">{brief}</div>
        {detail ? (
          <div className="mt-[5px] max-h-[56px] pb-[2px] text-[12px] leading-[1.4] text-muted">
            {detail}
          </div>
        ) : null}
      </div>

      <div
        className="min-h-0 min-w-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Composer sessionId={row.id} compact />
      </div>

      <div
        className="flex h-[30px] min-w-0 items-center gap-[7px] border-t border-border pt-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className={cx(
            'min-w-0 max-w-[112px] shrink truncate text-[11.5px] font-semibold',
            waiting ? 'text-attend' : 'text-muted',
          )}
        >
          {stateLabel}
        </span>
        <span className="h-[5px] min-w-[48px] max-w-[160px] flex-1 overflow-hidden rounded-[3px] bg-track">
          {hasProgress ? (
            <span
              className={cx(
                'block h-full transition-[width] duration-500',
                progress > 0 && progress < 66 ? 'bg-amber' : 'bg-green',
              )}
              style={{ width: `${progress}%` }}
            />
          ) : null}
        </span>
        {hasProgress ? (
          todoSteps.length ? (
            <PlanPopover
              label={progressLabel}
              steps={todoSteps}
              done={row.todo?.done ?? 0}
              total={row.todo?.total ?? 0}
            />
          ) : (
            <span className="w-[34px] shrink-0 text-right text-[11.5px] font-[650] tabular-nums">
              {progressLabel}
            </span>
          )
        ) : (
          <span className="w-[34px] shrink-0" />
        )}
        <span className="flex-1" />
        <ConfidenceDots conf={conf} note={row.sup?.note} />
        <button
          type="button"
          title={
            state === 'idle' || state === 'done'
              ? 'Terminer la tâche et la retirer de la flotte'
              : state === 'waiting'
                ? 'Ouvrir la question'
                : 'Ouvrir le détail'
          }
          onClick={(e) => {
            e.stopPropagation();
            action.run();
          }}
          className={cx(
            CARD_BTN,
            action.primary
              ? 'bg-green text-white hover:brightness-95'
              : 'border border-border bg-white text-text hover:bg-hover',
          )}
        >
          {action.label}
        </button>
      </div>

      {closeError ? (
        <div className="absolute inset-x-[13px] bottom-[46px] z-20 rounded-[6px] border border-border bg-white px-[8px] py-[4px] text-[11px] text-danger shadow">
          {closeError}
        </div>
      ) : null}

      {menuOpen && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 230 }}
              onClick={(e) => e.stopPropagation()}
              className="z-[200] overflow-hidden rounded-[8px] border border-border bg-card shadow-[0_6px_18px_rgba(0,0,0,.12)]"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void close();
                }}
                className="flex w-full cursor-pointer items-center gap-[8px] bg-transparent px-[12px] py-[9px] text-left text-[13.5px] text-text hover:bg-hover"
              >
                <span className="shrink-0 opacity-[.65]">
                  <CloseConversationIcon />
                </span>
                Fermer cette conversation
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
