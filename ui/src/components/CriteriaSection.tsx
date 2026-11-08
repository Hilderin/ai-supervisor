import { useEffect, useMemo, useState } from 'react';
import { fetchCriteria } from '../lib/api';
import type { CardState } from '../lib/cardState';
import { cx } from '../lib/cx';
import { collectEvidenceImages, evidenceAssetUrl, galleryIndex } from '../lib/evidenceGallery';
import type { CriteriaCounts, Criterion } from '../types';
import { EvidenceViewer } from './EvidenceViewer';
import { ChevronIcon } from './Icons';

interface Props {
  sessionId: string;
  state: CardState;
  /** lastUpdateAt:turnStartedAt : la liste se recharge quand la tâche bouge (les tool criteria produisent des messages) */
  refreshKey: string;
  /** comptes portés par la flotte ; la section ne se rend que s'il y a des critères */
  counts?: CriteriaCounts;
}

/**
 * Défaut d'ouverture : identique au plan, déplié tant que la tâche est en
 * cours (travaille ou attend l'humain), replié sinon.
 */
export function criteriaDefaultOpen(state: CardState): boolean {
  return state === 'busy' || state === 'waiting';
}

/** Préférence manuelle par carte : le choix de l'utilisateur prime tant que la page vit. */
const manualPref = new Map<string, boolean>();

const STATUS_LABEL: Record<Criterion['status'], string> = {
  todo: 'À faire',
  to_validate: 'À valider',
  to_fix: 'À corriger',
  validated: 'Validé',
};

function StatusBadge({ status }: { status: Criterion['status'] }) {
  return (
    <span
      data-testid="criterion-status"
      className={cx(
        'shrink-0 rounded-full px-[6px] py-[1px] text-[10.5px] font-semibold',
        status === 'validated'
          ? 'bg-green-soft text-green'
          : status === 'to_fix'
            ? 'bg-orange-soft text-attend'
            : status === 'to_validate'
              ? 'bg-amber/15 text-amber'
              : 'bg-hover text-muted',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

interface EvidenceProps {
  sessionId: string;
  evidence: Criterion['evidence'];
  /** référence du critère, pour nommer le bouton d'agrandissement */
  criterionRef: string;
  /** ouvre la visionneuse sur cette preuve (rang dans le critère) */
  onOpen?: (evidenceIndex: number) => void;
}

function Evidence({ sessionId, evidence, criterionRef, onOpen }: EvidenceProps) {
  if (!evidence.length) return null;
  return (
    <ul className="mt-[3px] flex flex-col gap-[3px]">
      {evidence.map((ev, i) => (
        <li
          key={i}
          data-testid="evidence-row"
          className="text-[11.5px] leading-[1.4] text-muted"
        >
          <div>
            <span className="font-semibold text-muted">[{ev.kind}]</span>{' '}
            {ev.path ? (
              <span
                title={ev.start_line ? `${ev.path} lignes ${ev.start_line}-${(ev.start_line ?? 1) + (ev.line_count ?? 1) - 1}` : ev.path}
                className="font-mono"
              >
                {ev.path}
                {ev.start_line ? `:${ev.start_line}${ev.line_count ? `+${ev.line_count}` : ''}` : ''} :{' '}
              </span>
            ) : null}
            <span className="whitespace-pre-wrap">{ev.text}</span>
          </div>
          {ev.kind === 'screenshot' && ev.path ? (
            <button
              type="button"
              data-testid="evidence-thumb"
              aria-label={`Agrandir la capture de preuve ${criterionRef}`}
              title="Agrandir la capture"
              onClick={() => onOpen?.(i)}
              className="mt-[4px] flex w-fit cursor-zoom-in rounded-[6px] border border-border bg-transparent p-0 outline-none transition-colors hover:border-green/60 focus-visible:ring-2 focus-visible:ring-green/40"
            >
              <img
                src={evidenceAssetUrl(sessionId, ev.path)}
                alt={ev.text.slice(0, 80)}
                className="max-h-[160px] rounded-[5px]"
                loading="lazy"
              />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Ligne d'un critère : ref, titre, badge d'état, preuve soumise, commentaire du vérificateur. */
export function CriterionRow({
  sessionId,
  criterion,
  onOpenEvidence,
}: {
  sessionId: string;
  criterion: Criterion;
  /** reçoit le rang de la preuve dans le critère ; absent, la miniature reste inerte */
  onOpenEvidence?: (evidenceIndex: number) => void;
}) {
  return (
    <li
      data-testid="criterion-row"
      className={cx(
        'rounded-[7px] border px-[9px] py-[7px]',
        criterion.status === 'validated'
          ? 'border-green/25'
          : criterion.status === 'to_fix'
            ? 'border-orange/30'
            : 'border-border',
      )}
    >
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="shrink-0 font-mono text-[11px] font-semibold text-muted">{criterion.ref}</span>
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.4]">{criterion.title}</span>
        <StatusBadge status={criterion.status} />
      </div>
      {criterion.detail ? (
        <div className="mt-[3px] text-[11.5px] leading-[1.4] text-muted">{criterion.detail}</div>
      ) : null}
      {criterion.methods.length ? (
        <div className="mt-[3px] text-[10.5px] text-placeholder">{criterion.methods.join(' · ')}</div>
      ) : null}
      <Evidence
        sessionId={sessionId}
        evidence={criterion.evidence}
        criterionRef={criterion.ref}
        onOpen={onOpenEvidence}
      />
      {criterion.status === 'to_fix' && criterion.review ? (
        <div className="mt-[4px] text-[11.5px] leading-[1.4] text-attend">
          Vérificateur : preuve refusée : {criterion.review}
        </div>
      ) : criterion.status === 'validated' && criterion.review ? (
        <div className="mt-[4px] text-[11.5px] leading-[1.4] text-green">
          Vérificateur : preuve acceptée : {criterion.review}
        </div>
      ) : null}
      {criterion.remove_proposed_at != null ? (
        <div className="mt-[4px] text-[11.5px] leading-[1.4] text-attend">
          Suppression proposée par le vérificateur : {criterion.remove_reason}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Section « Critères » du panneau de détail, sous le plan : ref, titre, badge
 * d'état, preuve soumise et dernier commentaire du vérificateur. La liste se
 * charge à la demande (la flotte ne transporte que les comptes) et se recharge
 * quand la tâche bouge. Une tâche sans critère n'affiche pas la section.
 */
export function CriteriaSection({ sessionId, state, refreshKey, counts }: Props) {
  const [open, setOpen] = useState(() => manualPref.get(sessionId) ?? criteriaDefaultOpen(state));
  const [rows, setRows] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** rang dans le lot des captures de la tâche, null quand la visionneuse est fermée */
  const [viewer, setViewer] = useState<number | null>(null);

  useEffect(() => {
    if (!manualPref.has(sessionId)) setOpen(criteriaDefaultOpen(state));
  }, [sessionId, state]);

  // changer de tâche ferme la visionneuse : le lot n'est plus le même
  useEffect(() => {
    setViewer(null);
  }, [sessionId]);

  useEffect(() => {
    const ctl = new AbortController();
    fetchCriteria(sessionId, ctl.signal)
      .then((r) => {
        setRows(r.criteria);
        setError(null);
      })
      .catch((e) => {
        if (String((e as Error)?.name) === 'AbortError') return;
        setError(String((e as Error)?.message ?? e));
      });
    return () => ctl.abort();
  }, [sessionId, refreshKey]);

  const toggle = () => {
    const next = !open;
    manualPref.set(sessionId, next);
    setOpen(next);
  };

  const validated = counts?.validated ?? rows.filter(r => r.status === 'validated').length;
  const total = counts?.total ?? rows.length;

  // lot de captures de la tâche : la navigation traverse tous les critères
  const images = useMemo(() => collectEvidenceImages(rows, sessionId), [rows, sessionId]);

  const openEvidence = (criterionId: number, evidenceIndex: number) => {
    const index = galleryIndex(images, criterionId, evidenceIndex);
    if (index >= 0) setViewer(index);
  };

  return (
    <div
      data-testid="criteria-section"
      className="mt-[12px] rounded-[9px] border border-border bg-render px-[12px] py-[10px]"
    >
      <button
        type="button"
        data-testid="criteria-header"
        aria-expanded={open}
        aria-label={open ? 'Replier les critères d’acceptation' : 'Déplier les critères d’acceptation'}
        onClick={toggle}
        className="flex min-w-0 w-full cursor-pointer items-center gap-[8px] rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-green/40"
      >
        <span className="shrink-0 text-[12px] font-semibold">Critères</span>
        <span className="min-w-0 text-[11px] tabular-nums text-muted">
          {total > 0 ? `${total} critère${total > 1 ? 's' : ''}` : ''}
        </span>
        <span className="flex-1" />
        {total > 0 ? (
          <span
            title="Critères validés sur le total"
            className={cx(
              'shrink-0 rounded-full px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums',
              validated >= total ? 'bg-green-soft text-green' : 'bg-hover text-muted',
            )}
          >
            {validated}/{total}
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
      {error ? (
        <div className="mt-[6px] text-[11.5px] text-danger">Critères indisponibles : {error}</div>
      ) : null}
      {open ? (
        <ul className="mt-[8px] flex flex-col gap-[6px]" data-testid="criteria-rows">
          {rows.map((c) => (
            <CriterionRow
              key={c.id}
              sessionId={sessionId}
              criterion={c}
              onOpenEvidence={(evidenceIndex) => openEvidence(c.id, evidenceIndex)}
            />
          ))}
        </ul>
      ) : null}
      {viewer != null && images.length ? (
        <EvidenceViewer
          images={images}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>
  );
}
