import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardState } from '../lib/cardState';
import { cardStateLabel } from '../lib/cardState';
import { fetchFleet, setSupervision } from '../lib/api';
import { closeQuestionOf, closeTask } from '../lib/closeTask';
import { cx } from '../lib/cx';
import { BUSY_BRIEF, briefRow, isStaleTurn, planLabel } from '../lib/fleet';
import { isUnsupervised, supervisionActionLabel } from '../lib/supervision';
import { useFleetStore } from '../store/fleetStore';
import type { FleetRow } from '../types';
import { ActivityLine } from './ActivityLine';
import { CardStateIcon } from './CardStateIcon';
import { CriteriaPopover } from './CriteriaPopover';
import { CloseConversationIcon, OpenChamberIcon, QuestionIcon, SupervisionIcon, SupervisionOffIcon } from './Icons';
import { PlanPopover } from './PlanPopover';

interface Props {
  row: FleetRow;
  state: CardState;
  selected: boolean;
  flash: boolean;
  now: number;
  onOpen: () => void;
  onOpenChamber: (sessionId: string) => void;
}

const CARD_BTN =
  'flex h-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] px-[9px] text-[11.5px] font-semibold';

/**
 * Carte à hauteur fixe, sans composer : l'écriture à une tâche passe par le
 * détail. Toutes les zones sont réservées dans tous les états : l'état ne
 * change que l'icône, le contenu interne et l'action du pied.
 */
export function SessionCard({ row, state, selected, flash, now, onOpen, onOpenChamber }: Props) {
  const closeSession = useFleetStore((s) => s.closeSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const waiting = state === 'waiting';
  const done = state === 'done';
  const busy = state === 'busy';
  // supervision opt-in : false = conversation démarrée directement dans
  // OpenChamber, sans compagnon ni vérificateur ; undefined (daemon ancien) = supervisée
  const unsupervised = isUnsupervised(row);
  const supervisionLabel = supervisionActionLabel(row);
  // au repos, jamais de ligne résiduelle : le daemon ne publie activity que
  // pour une session busy, l'UI s'abstient aussi par sécurité
  const activity = busy ? row.activity : undefined;
  const issue = row.issue;
  const stale = isStaleTurn(row);
  const form = row.pendingForms?.[0];
  const perm = row.pendingPermissions?.[0];
  const waitingKind = form ? 'form' : perm ? 'permission' : undefined;
  const brief = issue?.message || (issue ? cardStateLabel(state, waitingKind) : stale ? BUSY_BRIEF : row.sup?.resume || briefRow(row, waiting, now));
  const stateLabel = cardStateLabel(state, waitingKind);

  const hasProgress = row.sup?.progress != null || !!row.plan;
  const progress = row.sup?.progress != null ? Math.max(0, Math.min(100, Number(row.sup.progress))) : 0;
  const planSteps = row.plan?.steps ?? [];
  const progressLabel = planLabel(row.plan, done, progress);
  const attend = row.sup?.attend && (waiting || row.sup.humanSource === 'agent_ask') ? row.sup.attend : '';
  // critères : deuxième barre au même format que celle du plan, à sa droite ;
  // masquée sans critère (même règle que la barre du plan sans plan)
  const crit = row.criteria;
  const critTotal = crit?.total ?? 0;
  const critValidated = crit?.validated ?? 0;
  // réponses au propriétaire (tool answer) pas encore lues : le badge vit dans
  // en-tête, il ne change ni l'état ni la section de la carte
  const unreadAnswers = row.unreadAnswers ?? 0;
  const currentStep =
    row.plan?.steps?.find((step) => step.status === 'in_progress') ??
    row.plan?.steps?.find((step) => step.status === 'pending');
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

  // Bascule de supervision (opt-in) : le choix est persisté en BD côté daemon ;
  // le frame SSE suivant porte le nouvel état, aucun rechargement n'est requis.
  const toggleSupervision = async () => {
    setMenuOpen(false);
    setCloseError(null);
    try {
      await setSupervision(row.id, unsupervised);
      void fetchFleet().catch(() => undefined);
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
      if (top + 100 > window.innerHeight - 8) top = Math.max(8, rect.top - 100);
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
        : state === 'error' || state === 'retry'
          ? { label: 'Détail', primary: false, run: onOpen }
          : { label: 'Terminé', primary: true, run: () => void close() };

  let detail: ReactNode = null;
  if (state === 'waiting') {
    detail = (
      <span className="text-attend">
        <QuestionIcon /> {questionText}
      </span>
    );
  } else if (state === 'error' || state === 'retry') {
    const attempt = issue?.attempt ? ` · tentative ${issue.attempt}` : '';
    detail = (
      <span title={[issue?.message, issue?.errorType, issue?.errorStatus ? `HTTP ${issue.errorStatus}` : ''].filter(Boolean).join(' · ')}>
        {state === 'error' ? 'Échec OpenCode' : `Retry OpenCode${attempt}`}
      </span>
    );
  } else if (busy) {
    detail = currentStep ? (
      <span>Étape : {currentStep.text}</span>
    ) : attend ? (
      <span className="text-attend">
        <QuestionIcon /> {attend}
      </span>
    ) : null;
  } else if (state === 'idle' && attend) {
    detail = (
      <span className="text-attend">
        <QuestionIcon /> {attend}
      </span>
    );
  }
  // Au repos, pas de bloc de résultat dans la carte : l'aperçu de deux lignes
  // n'apportait rien et poussait le résumé hors du peu de place disponible ;
  // la livraison complète reste dans le détail (DeliveryBlock).

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
        'relative grid h-[190px] w-full min-w-0 cursor-pointer grid-cols-1 grid-rows-[24px_minmax(0,1fr)_30px] gap-[8px] overflow-hidden rounded-[11px] border px-[13px] pb-[10px] pt-[11px] outline-none',
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
        {unreadAnswers > 0 ? (
          <span
            data-testid="card-unread-answers"
            title="Nouvelles réponses de cette tâche : ouvert le détail pour les lire"
            className="shrink-0 rounded-full bg-orange-soft px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums text-attend"
          >
            {unreadAnswers > 1 ? `${unreadAnswers} réponses` : '1 réponse'}
          </span>
        ) : null}
        {unsupervised ? (
          <span
            data-testid="card-unsupervised"
            title="Conversation démarrée directement dans OpenChamber : ni compagnon ni vérificateur. Menu ⋯ pour l'activer."
            className="flex shrink-0 items-center gap-[4px] rounded-full border border-border px-[7px] py-[1px] text-[10px] font-semibold text-muted"
          >
            <SupervisionOffIcon />
            Non supervisée
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
          title="Ouvrir dans le mini chat OpenChamber"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChamber(row.id);
          }}
          className="flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-muted hover:bg-green-soft hover:text-green"
        >
          <OpenChamberIcon />
        </button>
      </div>

      <div className="min-h-0 min-w-0 overflow-hidden">
        {activity ? <ActivityLine activity={activity} className="mb-[4px]" /> : null}
        <div className="line-clamp-2 pb-[2px] text-[13.5px] leading-[1.45] text-muted">{brief}</div>
        {detail ? (
          <div className="mt-[5px] max-h-[56px] pb-[2px] text-[12px] leading-[1.4] text-muted">
            {detail}
          </div>
        ) : null}
      </div>

      <div
        className="flex h-[30px] min-w-0 items-center gap-[7px] border-t border-border pt-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span
          data-testid="card-state-label"
          className={cx(
            // colonne à largeur fixe : le libellé ne pousse plus la barre ni la
            // valeur de progression, qui restent alignées d'une carte à l'autre
            'w-[112px] min-w-0 shrink truncate text-[11.5px] font-semibold',
            waiting ? 'text-attend' : 'text-muted',
          )}
        >
          {stateLabel}
        </span>
        <span
          data-testid="plan-progress-bar"
          // largeur liée à la carte, jamais au contenu voisin : la fin de la
          // barre, donc la colonne de la valeur, tombe au même x sur toutes les
          // cartes d'une même flotte (clamp : le plafond existant de 160 px)
          className="h-[5px] w-[clamp(110px,19%,160px)] min-w-[48px] shrink overflow-hidden rounded-[3px] bg-track"
        >
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
          planSteps.length ? (
            <PlanPopover
              label={progressLabel}
              steps={planSteps}
              done={row.plan?.done ?? 0}
              total={row.plan?.total ?? 0}
            />
          ) : (
            // même largeur que le compteur cliquable du plan (38 px), sinon la
            // valeur glisse selon la présence d'un plan ; le retrait de 2 px
            // aligne le texte sur celui du bouton (qui a un padding de 2 px)
            <span
              data-testid="card-progress-value"
              className="w-[38px] shrink-0 pr-[2px] text-right text-[11.5px] font-[650] tabular-nums"
            >
              {progressLabel}
            </span>
          )
        ) : (
          <span className="w-[38px] shrink-0" />
        )}
        {critTotal > 0 ? (
          <>
            {/* plus d'air AVANT la barre (après le libellé du plan), et le
                compteur est serré (min-width réduit) : demande explicite du
                propriétaire, l'inverse était en place */}
            <span
              data-testid="criteria-progress-bar"
              className="ml-[15px] h-[5px] min-w-[48px] max-w-[160px] flex-1 overflow-hidden rounded-[3px] bg-track"
              aria-label={`Critères : ${critValidated} validés sur ${critTotal}`}
            >
              <span
                className={cx(
                  'block h-full transition-[width] duration-500',
                  critValidated >= critTotal ? 'bg-green' : 'bg-amber',
                )}
                style={{ width: `${Math.round((critValidated / critTotal) * 100)}%` }}
              />
            </span>
            <CriteriaPopover
              sessionId={row.id}
              label={`${critValidated}/${critTotal}`}
              done={critValidated}
              total={critTotal}
            />
          </>
        ) : null}
        <span className="flex-1" />
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
        <div className="absolute inset-x-[13px] bottom-[40px] z-20 rounded-[6px] border border-border bg-white px-[8px] py-[4px] text-[11px] text-danger shadow">
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
                  void toggleSupervision();
                }}
                className="flex w-full cursor-pointer items-center gap-[8px] bg-transparent px-[12px] py-[9px] text-left text-[13.5px] text-text hover:bg-hover"
              >
                <span className="shrink-0 opacity-[.65]">
                  <SupervisionIcon />
                </span>
                {supervisionLabel}
              </button>
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
