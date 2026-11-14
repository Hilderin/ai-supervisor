import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchCriteria } from '../lib/api';
import type { CardState } from '../lib/cardState';
import { cx } from '../lib/cx';
import { collectEvidenceImages, evidenceAssetUrl, galleryIndex } from '../lib/evidenceGallery';
import type { CriteriaCounts, Criterion, EvidenceItem } from '../types';
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

/**
 * Libellé court d'un type de preuve : la chip reste étroite, le vocabulaire
 * des tools reste reconnaissable (un kind inconnu s'affiche tel quel).
 */
const EVIDENCE_LABEL: Record<string, string> = {
  unit_test: 'test',
  e2e: 'e2e',
  browser_nav: 'navigateur',
  screenshot: 'capture',
  human: 'humain',
  text: 'texte',
  code_excerpt: 'code',
  artifact: 'artefact',
  command: 'commande',
  diff: 'diff',
  doc: 'doc',
};

export function evidenceLabel(kind: string): string {
  return EVIDENCE_LABEL[kind] ?? kind;
}

/** Note de jugement rattachée au badge (l'agent juge lui-même, la note reste accessible au survol). */
export function reviewTitle(criterion: Criterion): string | undefined {
  const review = criterion.review?.trim();
  if (!review) return undefined;
  if (criterion.status === 'validated') return `Preuve acceptée : ${review}`;
  if (criterion.status === 'to_fix') return `Preuve refusée : ${review}`;
  return review;
}

/** Infobulle du titre : le détail et les méthodes, sans occuper de ligne. */
function criterionHint(criterion: Criterion): string {
  return [criterion.detail?.trim(), criterion.methods.join(' · ')]
    .filter(Boolean)
    .join('\n');
}

function StatusBadge({ criterion }: { criterion: Criterion }) {
  return (
    <span
      data-testid="criterion-status"
      title={reviewTitle(criterion)}
      className={cx(
        'shrink-0 rounded-full px-[6px] py-[1px] text-[10.5px] font-semibold',
        criterion.status === 'validated'
          ? 'bg-green-soft text-green'
          : criterion.status === 'to_fix'
            ? 'bg-orange-soft text-attend'
            : criterion.status === 'to_validate'
              ? 'bg-amber/15 text-amber'
              : 'bg-hover text-muted',
      )}
    >
      {STATUS_LABEL[criterion.status]}
    </span>
  );
}

/** Case cochée des chips valides (même métaphore qu'une checklist). */
function CheckboxIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="10" height="10" rx="2.4" />
      <path d="M3.4 6.2 5.2 8l3.4-3.7" />
    </svg>
  );
}

/** Point des chips en attente : présence neutre, sans coche. */
function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="3" fill="currentColor" />
    </svg>
  );
}

function evidenceLines(evidence: EvidenceItem): string {
  if (!evidence.path) return '';
  return evidence.start_line
    ? `${evidence.path}:${evidence.start_line}${evidence.line_count ? `+${evidence.line_count}` : ''}`
    : evidence.path;
}

function evidenceDate(at: number): string {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Contenu du détail d'une preuve, séparé pour le rendu statique des tests :
 * le texte complet, le fichier (chemin et lignes) et l'image éventuelle.
 */
export function EvidenceDetail({
  sessionId,
  criterion,
  evidence,
  onOpenImage,
}: {
  sessionId: string;
  criterion: Criterion;
  evidence: EvidenceItem;
  onOpenImage?: () => void;
}) {
  const validated = criterion.status === 'validated';
  const path = evidenceLines(evidence);
  const image = evidence.kind === 'screenshot' && evidence.path;
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-[11.5px] font-semibold">{evidenceLabel(evidence.kind)}</span>
        <span
          data-testid="evidence-detail-state"
          className={cx(
            'shrink-0 text-[10.5px] font-semibold',
            validated ? 'text-green' : 'text-muted',
          )}
        >
          {validated ? 'preuve validée' : 'preuve en attente'}
        </span>
      </div>
      {path ? (
        <div
          data-testid="evidence-detail-path"
          className="break-all font-mono text-[10.5px] leading-[1.4] text-muted"
        >
          {path}
        </div>
      ) : null}
      {image ? (
        <button
          type="button"
          title="Ouvrir la capture en grand"
          onClick={onOpenImage}
          className="w-fit cursor-zoom-in rounded-[6px] border border-border p-0 outline-none focus-visible:ring-2 focus-visible:ring-green/40"
        >
          <img
            src={evidenceAssetUrl(sessionId, evidence.path!)}
            alt={evidence.text.slice(0, 80)}
            className="max-h-[240px] max-w-full rounded-[5px]"
            loading="lazy"
          />
        </button>
      ) : null}
      <div
        data-testid="evidence-detail-text"
        className="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-[1.45] text-text"
      >
        {evidence.text}
      </div>
      {evidence.at ? (
        <div className="text-[10px] text-placeholder">fournie le {evidenceDate(evidence.at)}</div>
      ) : null}
    </div>
  );
}

const POPOVER_WIDTH = 340;
const POPOVER_GAP = 6;
const POPOVER_MARGIN = 8;
/**
 * Chip d'une preuve : verte avec une case cochée quand le critère est validé,
 * grise avec un point sinon. Le clic ouvre le détail (texte, chemin, image)
 * dans une bulle portail, sans agrandir la liste.
 */
export function EvidenceChip({
  sessionId,
  criterion,
  evidence,
  onOpenImage,
}: {
  sessionId: string;
  criterion: Criterion;
  evidence: EvidenceItem;
  /** ouvre la capture dans la visionneuse du lot (absent, l'image reste dans la bulle) */
  onOpenImage?: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const validated = criterion.status === 'validated';
  const label = evidenceLabel(evidence.kind);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      if (!anchor || !pop) return;
      const left = Math.min(
        Math.max(POPOVER_MARGIN, anchor.left),
        window.innerWidth - pop.width - POPOVER_MARGIN,
      );
      let top = anchor.bottom + POPOVER_GAP;
      if (top + pop.height > window.innerHeight - POPOVER_MARGIN) {
        top = Math.max(POPOVER_MARGIN, anchor.top - pop.height - POPOVER_GAP);
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
        data-testid="evidence-chip"
        data-kind={evidence.kind}
        data-state={validated ? 'valid' : 'pending'}
        aria-label={`Preuve ${label} : ${validated ? 'validée' : 'en attente'} (ouvrir le détail)`}
        aria-expanded={open}
        title={`${label} : ${validated ? 'preuve validée' : 'preuve en attente'}`}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'flex h-[19px] cursor-pointer items-center gap-[3px] rounded-full border px-[6px] text-[10.5px] font-semibold',
          validated
            ? 'border-green/30 bg-green-soft text-green'
            : 'border-border bg-hover text-muted hover:border-placeholder',
        )}
      >
        {validated ? <CheckboxIcon /> : <DotIcon />}
        <span>{label}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label={`Détail de la preuve ${label}`}
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: POPOVER_WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="z-[300] flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto rounded-[9px] border border-border bg-card px-[11px] py-[9px] text-left shadow-[0_8px_22px_rgba(0,0,0,.16)]"
            >
              <EvidenceDetail
                sessionId={sessionId}
                criterion={criterion}
                evidence={evidence}
                onOpenImage={() => {
                  setOpen(false);
                  onOpenImage?.();
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Captures du critère, sous les chips : elles restent visibles, cliquables. */
function EvidenceThumbs({
  sessionId,
  criterion,
  onOpen,
}: {
  sessionId: string;
  criterion: Criterion;
  onOpen?: (evidenceIndex: number) => void;
}) {
  const shots = criterion.evidence
    .map((evidence, evidenceIndex) => ({ evidence, evidenceIndex }))
    .filter(({ evidence }) => evidence.kind === 'screenshot' && evidence.path);
  if (!shots.length) return null;
  return (
    <div data-testid="evidence-thumbs" className="mt-[4px] flex flex-wrap gap-[4px]">
      {shots.map(({ evidence, evidenceIndex }) => (
        <button
          key={evidenceIndex}
          type="button"
          data-testid="evidence-thumb"
          aria-label={`Agrandir la capture de preuve ${criterion.ref}`}
          title="Agrandir la capture"
          onClick={() => onOpen?.(evidenceIndex)}
          className="flex w-fit cursor-zoom-in rounded-[6px] border border-border bg-transparent p-0 outline-none transition-colors hover:border-green/60 focus-visible:ring-2 focus-visible:ring-green/40"
        >
          <img
            src={evidenceAssetUrl(sessionId, evidence.path!)}
            alt={evidence.text.slice(0, 80)}
            className="max-h-[110px] rounded-[5px]"
            loading="lazy"
          />
        </button>
      ))}
    </div>
  );
}

/**
 * Une preuve dans le détail du critère : type, état, date, chemin et lignes,
 * texte complet et image. Plus aérée que les chips de la liste.
 */
function CriterionEvidenceBlock({
  sessionId,
  criterion,
  evidence,
  evidenceIndex,
  onOpenImage,
}: {
  sessionId: string;
  criterion: Criterion;
  evidence: EvidenceItem;
  evidenceIndex: number;
  onOpenImage?: (evidenceIndex: number) => void;
}) {
  const validated = criterion.status === 'validated';
  const path = evidenceLines(evidence);
  const image = evidence.kind === 'screenshot' && evidence.path;
  return (
    <div
      data-testid="detail-evidence"
      className="rounded-[8px] border border-border bg-card px-[10px] py-[8px]"
    >
      <div className="flex flex-wrap items-center gap-[6px]">
        <span className="rounded-full border border-border bg-hover px-[6px] py-[1px] text-[10.5px] font-semibold text-text">
          {evidenceLabel(evidence.kind)}
        </span>
        <span
          className={cx(
            'text-[10.5px] font-semibold',
            validated ? 'text-green' : 'text-muted',
          )}
        >
          {validated ? 'preuve validée' : 'preuve en attente'}
        </span>
        <span className="flex-1" />
        {evidence.at ? (
          <span className="text-[10.5px] text-placeholder">fournie le {evidenceDate(evidence.at)}</span>
        ) : null}
      </div>
      {path ? (
        <div className="mt-[5px] break-all font-mono text-[11px] leading-[1.4] text-muted">{path}</div>
      ) : null}
      {image ? (
        <button
          type="button"
          title="Ouvrir la capture en grand"
          onClick={() => onOpenImage?.(evidenceIndex)}
          className="mt-[6px] flex w-fit cursor-zoom-in rounded-[6px] border border-border p-0 outline-none focus-visible:ring-2 focus-visible:ring-green/40"
        >
          <img
            src={evidenceAssetUrl(sessionId, evidence.path!)}
            alt={evidence.text.slice(0, 80)}
            className="max-h-[320px] max-w-full rounded-[5px]"
            loading="lazy"
          />
        </button>
      ) : null}
      {evidence.text ? (
        <div
          data-testid="detail-evidence-text"
          className="mt-[6px] whitespace-pre-wrap text-[12px] leading-[1.5] text-text"
        >
          {evidence.text}
        </div>
      ) : null}
    </div>
  );
}

function sectionTitle(text: string) {
  return (
    <div className="mb-[5px] text-[10.5px] font-semibold uppercase tracking-[.05em] text-muted">
      {text}
    </div>
  );
}

/**
 * Corps du détail d'un critère, séparé du portail pour le rendu statique des
 * tests : détail, méthodes, toutes les preuves et le jugement de l'agent.
 */
export function CriterionDetailBody({
  sessionId,
  criterion,
  onOpenImage,
}: {
  sessionId: string;
  criterion: Criterion;
  onOpenImage?: (evidenceIndex: number) => void;
}) {
  const review = criterion.review?.trim();
  const accepted = criterion.status === 'validated';
  const reviewBox = review ? (
    <section
      data-testid="criterion-review"
      className={cx(
        'rounded-[8px] border px-[10px] py-[8px]',
        accepted
          ? 'border-green/25 bg-green-soft'
          : criterion.status === 'to_fix'
            ? 'border-orange/30 bg-orange-soft'
            : 'border-border bg-hover',
      )}
    >
      <div
        className={cx(
          'text-[10.5px] font-semibold uppercase tracking-[.05em]',
          accepted ? 'text-green' : criterion.status === 'to_fix' ? 'text-attend' : 'text-muted',
        )}
      >
        {accepted
          ? 'Preuve acceptée'
          : criterion.status === 'to_fix'
            ? 'Preuve refusée'
            : 'Jugement de l’agent'}
      </div>
      <div className="mt-[4px] whitespace-pre-wrap text-[12.5px] leading-[1.5] text-text">
        {review}
      </div>
    </section>
  ) : null;
  return (
    <div className="flex flex-col gap-[13px]">
      {reviewBox}
      {criterion.detail ? (
        <section>
          {sectionTitle('Détail du critère')}
          <div
            data-testid="criterion-detail-text"
            className="whitespace-pre-wrap text-[12.5px] leading-[1.5] text-text"
          >
            {criterion.detail}
          </div>
        </section>
      ) : null}
      {criterion.methods.length ? (
        <section>
          {sectionTitle('Méthodes de validation')}
          <div className="flex flex-wrap gap-[4px]">
            {criterion.methods.map((method) => (
              <span
                key={method}
                className="rounded-full border border-border bg-hover px-[7px] py-[1px] text-[10.5px] text-muted"
              >
                {method}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        {sectionTitle(`Preuves (${criterion.evidence.length})`)}
        {criterion.evidence.length ? (
          <div className="flex flex-col gap-[7px]">
            {criterion.evidence.map((evidence, evidenceIndex) => (
              <CriterionEvidenceBlock
                key={evidenceIndex}
                sessionId={sessionId}
                criterion={criterion}
                evidence={evidence}
                evidenceIndex={evidenceIndex}
                onOpenImage={onOpenImage}
              />
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted">Aucune preuve soumise pour ce critère.</div>
        )}
      </section>
    </div>
  );
}

/** Volet borné dans la liste des critères : null aux extrémités (pas de bouclage). */
export function neighborCriterionIndex(index: number, total: number, delta: number): number | null {
  if (index < 0 || index >= total) return null;
  const next = index + delta;
  return next >= 0 && next < total ? next : null;
}

/**
 * Popup du détail d'un critère : plus grand et plus aéré que la ligne, il
 * montre tout ce qu'on ne lit plus dans la liste, et permet de passer au
 * critère précédent ou suivant (boutons et flèches du clavier).
 */
export function CriterionDetailDialog({
  sessionId,
  criterion,
  index,
  total,
  onPrevious,
  onNext,
  onClose,
  onOpenImage,
  keysEnabled = true,
}: {
  sessionId: string;
  criterion: Criterion;
  /** rang affiché, base 0 */
  index: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onOpenImage?: (evidenceIndex: number) => void;
  /** false quand la visionneuse de preuves est au-dessus (elle gère ses propres touches) */
  keysEnabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      const target = previousFocus.current;
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    if (!keysEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // capture + stopPropagation : le panneau de détail écoute Échap en bulle
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowLeft' && onPrevious) {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (event.key === 'ArrowRight' && onNext) {
        event.preventDefault();
        onNext();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, onPrevious, onNext, keysEnabled]);

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-start justify-center bg-[rgba(13,17,14,.22)] px-[12px] py-[7vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Détail du critère ${criterion.ref}`}
        tabIndex={-1}
        className="flex max-h-[86vh] w-[min(720px,calc(100vw-24px))] flex-col overflow-hidden rounded-[11px] border border-border bg-render text-left shadow-[0_18px_50px_rgba(0,0,0,.25)] outline-none"
      >
        <div className="flex items-start gap-[10px] border-b border-border bg-card px-[16px] py-[11px]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[8px]">
              <span className="font-mono text-[12px] font-semibold text-muted">{criterion.ref}</span>
              <StatusBadge criterion={criterion} />
            </div>
            <div
              data-testid="criterion-detail-title"
              className="mt-[3px] text-[15.5px] font-semibold leading-[1.35]"
            >
              {criterion.title}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-[6px]">
            <span className="tabular-nums text-[11px] text-muted">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              data-testid="criterion-detail-close"
              aria-label="Fermer le détail du critère"
              title="Fermer (Échap)"
              onClick={onClose}
              className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[6px] text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
            >
              ×
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[13px]">
          <CriterionDetailBody
            sessionId={sessionId}
            criterion={criterion}
            onOpenImage={onOpenImage}
          />
        </div>
        <div className="flex items-center justify-between border-t border-border bg-card px-[16px] py-[8px]">
          <button
            type="button"
            data-testid="criterion-previous"
            disabled={!onPrevious}
            onClick={onPrevious}
            className="cursor-pointer rounded-[6px] border border-border bg-white px-[10px] py-[4px] text-[11.5px] font-medium text-text hover:bg-hover disabled:cursor-default disabled:opacity-40"
          >
            ‹ Précédent
          </button>
          <span className="text-[10.5px] text-muted">flèches gauche et droite</span>
          <button
            type="button"
            data-testid="criterion-next"
            disabled={!onNext}
            onClick={onNext}
            className="cursor-pointer rounded-[6px] border border-border bg-white px-[10px] py-[4px] text-[11.5px] font-medium text-text hover:bg-hover disabled:cursor-default disabled:opacity-40"
          >
            Suivant ›
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Ligne d'un critère : ref, titre et état sur une ligne, puis une chip par
 * preuve (le détail s'ouvre au clic) et les captures en dessous. Le clic sur
 * la ligne ouvre le popup du critère (détail, preuves, jugement).
 */
export function CriterionRow({
  sessionId,
  criterion,
  onOpenEvidence,
  onOpen,
}: {
  sessionId: string;
  criterion: Criterion;
  /** reçoit le rang de la preuve dans le critère ; absent, la miniature reste inerte */
  onOpenEvidence?: (evidenceIndex: number) => void;
  /** ouvre le détail complet du critère (popup) */
  onOpen?: () => void;
}) {
  const hint = criterionHint(criterion);
  return (
    <li
      data-testid="criterion-row"
      className={cx(
        'rounded-[7px] border px-[8px] py-[5px]',
        criterion.status === 'validated'
          ? 'border-green/25'
          : criterion.status === 'to_fix'
            ? 'border-orange/30'
            : 'border-border',
      )}
    >
      <button
        type="button"
        data-testid="criterion-open"
        aria-label={`Ouvrir le détail du critère ${criterion.ref}`}
        onClick={onOpen}
        className="flex w-full min-w-0 cursor-pointer items-center gap-[7px] rounded-[5px] text-left outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-green/40"
      >
        <span className="shrink-0 font-mono text-[11px] font-semibold text-muted">{criterion.ref}</span>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] leading-[1.4]"
          title={hint || criterion.title}
        >
          {criterion.title}
        </span>
        <StatusBadge criterion={criterion} />
      </button>
      {criterion.evidence.length ? (
        <div data-testid="evidence-chips" className="mt-[4px] flex flex-wrap items-center gap-[4px]">
          {criterion.evidence.map((evidence, evidenceIndex) => (
            <EvidenceChip
              key={evidenceIndex}
              sessionId={sessionId}
              criterion={criterion}
              evidence={evidence}
              onOpenImage={
                onOpenEvidence ? () => onOpenEvidence(evidenceIndex) : undefined
              }
            />
          ))}
        </div>
      ) : null}
      <EvidenceThumbs sessionId={sessionId} criterion={criterion} onOpen={onOpenEvidence} />
    </li>
  );
}

/**
 * Section « Critères » du panneau de détail, sous le plan : ref, titre et état,
 * une chip par preuve (détail au clic) et les captures. La liste se charge à la
 * demande (la flotte ne transporte que les comptes) et se recharge quand la
 * tâche bouge. Une tâche sans critère n'affiche pas la section.
 */
export function CriteriaSection({ sessionId, state, refreshKey, counts }: Props) {
  const [open, setOpen] = useState(() => manualPref.get(sessionId) ?? criteriaDefaultOpen(state));
  const [rows, setRows] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** critère ouvert dans le popup de détail (id stable pendant les rechargements) */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** rang dans le lot des captures de la tâche, null quand la visionneuse est fermée */
  const [viewer, setViewer] = useState<number | null>(null);

  useEffect(() => {
    if (!manualPref.has(sessionId)) setOpen(criteriaDefaultOpen(state));
  }, [sessionId, state]);

  // changer de tâche ferme la visionneuse et le popup : le lot n'est plus le même
  useEffect(() => {
    setViewer(null);
    setSelectedId(null);
  }, [sessionId]);

  // un rechargement qui fait disparaître le critère ouvert ferme le popup
  useEffect(() => {
    if (selectedId == null) return;
    if (!rows.some((row) => row.id === selectedId)) setSelectedId(null);
  }, [rows, selectedId]);

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
    if (!next) setSelectedId(null);
  };

  const validated = counts?.validated ?? rows.filter(r => r.status === 'validated').length;
  const total = counts?.total ?? rows.length;

  // lot de captures de la tâche : la navigation traverse tous les critères
  const images = useMemo(() => collectEvidenceImages(rows, sessionId), [rows, sessionId]);

  const openEvidence = (criterionId: number, evidenceIndex: number) => {
    const index = galleryIndex(images, criterionId, evidenceIndex);
    if (index >= 0) setViewer(index);
  };

  const detailIndex = selectedId == null ? -1 : rows.findIndex((row) => row.id === selectedId);
  const detail = detailIndex >= 0 ? rows[detailIndex] : null;
  const previousIndex = neighborCriterionIndex(detailIndex, rows.length, -1);
  const nextIndex = neighborCriterionIndex(detailIndex, rows.length, 1);

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
        <ul className="mt-[8px] flex flex-col gap-[5px]" data-testid="criteria-rows">
          {rows.map((c) => (
            <CriterionRow
              key={c.id}
              sessionId={sessionId}
              criterion={c}
              onOpen={() => setSelectedId(c.id)}
              onOpenEvidence={(evidenceIndex) => openEvidence(c.id, evidenceIndex)}
            />
          ))}
        </ul>
      ) : null}
      {detail ? (
        <CriterionDetailDialog
          sessionId={sessionId}
          criterion={detail}
          index={detailIndex}
          total={rows.length}
          onPrevious={
            previousIndex != null ? () => setSelectedId(rows[previousIndex]!.id) : undefined
          }
          onNext={
            nextIndex != null ? () => setSelectedId(rows[nextIndex]!.id) : undefined
          }
          onClose={() => setSelectedId(null)}
          onOpenImage={(evidenceIndex) => openEvidence(detail.id, evidenceIndex)}
          keysEnabled={viewer == null}
        />
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
