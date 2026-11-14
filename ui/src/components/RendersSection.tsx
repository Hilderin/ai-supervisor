import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ackRenders, fetchRenders } from '../lib/api';
import { cx } from '../lib/cx';
import { RENDER_MAX_HEIGHT } from '../lib/renderDoc';
import type { TaskRender } from '../types';
import { SandboxedRender } from './SandboxedRender';
import { UiBlock } from './UiBlock';

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
 * Découpe de la liste brute (ordre du fil, plus ancien d'abord) : rendus non vus
 * et rendus antérieurs, les plus récents d'abord. Exporté pour les tests (le
 * chargement n'est pas testable en rendu statique).
 */
export function splitRenders(renders: TaskRender[]): { pending: TaskRender[]; seen: TaskRender[] } {
  const newestFirst = renders.slice().sort((a, b) => b.at - a.at || b.id - a.id);
  return {
    pending: newestFirst.filter((r) => !r.read_at),
    seen: newestFirst.filter((r) => !!r.read_at),
  };
}

/**
 * Contenu d'un rendu : page HTML dans l'iframe sandboxée (jamais de HTML dans
 * le DOM), ou source openui-lang dessinée par le parseur d'OpenChamber (repli
 * en code brut pour un composant interactif, comme dans le chat).
 */
export function RenderFrame({ render, maxHeight = RENDER_MAX_HEIGHT }: { render: TaskRender; maxHeight?: number }) {
  if (render.kind === 'html') {
    return <SandboxedRender html={render.content} title={render.title} maxHeight={maxHeight} />;
  }
  return (
    <div
      data-testid="render-ui-source"
      className="max-h-[320px] overflow-auto rounded-[7px] border border-border bg-white px-[10px] py-[8px]"
    >
      <UiBlock source={render.content} />
    </div>
  );
}

/**
 * Contenu du popup agrandi, hors portail : testable en rendu statique. Même
 * gabarit que le détail d'un critère (en-tête, corps qui défile, fermeture).
 */
export function RenderDialogPanel({
  render,
  onClose,
  panelRef,
}: {
  render: TaskRender;
  onClose: () => void;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      className="fixed inset-0 z-[450] flex items-start justify-center bg-[rgba(13,17,14,.24)] px-[12px] py-[5vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Rendu ${render.title}`}
        data-testid="render-dialog"
        tabIndex={-1}
        className="flex max-h-[90vh] w-[min(980px,calc(100vw-24px))] flex-col overflow-hidden rounded-[11px] border border-border bg-render text-left shadow-[0_18px_50px_rgba(0,0,0,.25)] outline-none"
      >
        <div className="flex items-start gap-[10px] border-b border-border bg-card px-[16px] py-[11px]">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-[0.04em] text-muted">Rendu OpenChamber</div>
            <div
              data-testid="render-dialog-title"
              className="mt-[2px] text-[15.5px] font-semibold leading-[1.35]"
            >
              {render.title}
            </div>
            <div className="mt-[2px] text-[11px] tabular-nums text-muted">{timeLabel(render.at)}</div>
          </div>
          <button
            type="button"
            data-testid="render-dialog-close"
            aria-label="Fermer le rendu"
            title="Fermer (Échap)"
            onClick={onClose}
            className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[13px]">
          <RenderFrame render={render} maxHeight={640} />
        </div>
      </div>
    </div>
  );
}

/**
 * Popup agrandi d'un rendu, en portail sur `document.body` : le détail n'est
 * pas démonté et garde sa position de lecture. Échap est écouté en capture pour
 * ne pas fermer aussi le panneau de détail (qui l'écoute en bulle).
 */
export function RenderDialog({ render, onClose }: { render: TaskRender; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <RenderDialogPanel render={render} onClose={onClose} panelRef={panelRef} />,
    document.body,
  );
}

/**
 * Rendus OpenChamber de la tâche (tool `openchamber_render`), sous les réponses.
 * La section n'existe que s'il y a au moins un rendu. Les rendus non vus sont
 * affichés par défaut, chacun avec « Vu » (marque consulté, de façon persistée)
 * et « Agrandir » (popup fermable). Les rendus déjà vus restent dans
 * « Rendus antérieurs ».
 */
export function RendersSection({ sessionId, refreshKey }: Props) {
  const [renders, setRenders] = useState<TaskRender[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showSeen, setShowSeen] = useState(false);
  const [acking, setAcking] = useState<number | null>(null);
  const [opened, setOpened] = useState<TaskRender | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    let alive = true;
    fetchRenders(sessionId, ctl.signal)
      .then((list) => { if (alive) setRenders(list); })
      .catch((e) => {
        if (!alive || (e as Error)?.name === 'AbortError') return;
        // la liste déjà rendue reste à l'écran : une lecture ratée ne la vide pas
      });
    return () => { alive = false; ctl.abort(); };
  }, [sessionId, refreshKey, attempt]);

  if (!renders) return null;
  const { pending, seen } = splitRenders(renders);
  if (pending.length === 0 && seen.length === 0) return null;

  const markSeen = async (render: TaskRender) => {
    setAcking(render.id);
    try {
      await ackRenders(sessionId, [render.id]);
      setAttempt((n) => n + 1);
    } finally {
      setAcking(null);
    }
  };

  return (
    <div data-testid="renders-section" className="mt-[12px] rounded-[9px] border border-border bg-render px-[12px] py-[10px]">
      <div className="flex min-w-0 items-center gap-[8px]">
        <span className="shrink-0 text-[12px] font-semibold">Rendus de l'agent</span>
        {pending.length ? (
          <span
            title="Rendus OpenChamber pas encore marqués comme vus"
            className="shrink-0 rounded-full bg-orange-soft px-[6px] py-[1px] text-[10.5px] font-semibold tabular-nums text-attend"
          >
            {pending.length > 1 ? `${pending.length} nouveaux` : '1 nouveau'}
          </span>
        ) : null}
        <span className="flex-1" />
        {seen.length ? (
          <button
            type="button"
            data-testid="renders-journal"
            aria-expanded={showSeen}
            onClick={() => setShowSeen((v) => !v)}
            className="cursor-pointer shrink-0 text-[11.5px] font-semibold text-muted hover:text-text hover:underline"
          >
            Rendus antérieurs ({seen.length})
          </button>
        ) : null}
      </div>

      <div data-testid="renders-list" className="mt-[8px] flex flex-col gap-[8px]">
        {showSeen
          ? seen.map((render) => (
              <RenderCard
                key={render.id}
                render={render}
                seen
                acking={acking === render.id}
                onOpen={() => setOpened(render)}
              />
            ))
          : null}
        {showSeen && pending.length && seen.length ? <div className="h-px shrink-0 bg-border" role="presentation" /> : null}
        {pending.map((render) => (
          <RenderCard
            key={render.id}
            render={render}
            acking={acking === render.id}
            onOpen={() => setOpened(render)}
            onSeen={() => void markSeen(render).catch(() => setAttempt((n) => n + 1))}
          />
        ))}
      </div>

      {pending.length === 0 ? (
        <div className="mt-[6px] text-[11px] text-muted">Tous les rendus sont vus.</div>
      ) : null}

      {opened ? <RenderDialog render={opened} onClose={() => setOpened(null)} /> : null}
    </div>
  );
}

function RenderCard({
  render,
  seen = false,
  acking = false,
  onOpen,
  onSeen,
}: {
  render: TaskRender;
  seen?: boolean;
  acking?: boolean;
  onOpen: () => void;
  onSeen?: () => void;
}) {
  return (
    <div
      data-testid={seen ? 'render-seen' : 'render-visible'}
      className={cx(
        'rounded-[7px] border px-[10px] py-[8px]',
        seen ? 'border-border bg-white/50' : 'border-wait-border bg-white',
      )}
    >
      <div className="flex min-w-0 items-center gap-[7px] text-[10.5px] text-muted">
        <span className="shrink-0 tabular-nums">{timeLabel(render.at)}</span>
        <span className="min-w-0 truncate font-semibold text-text" title={render.title}>
          {render.title}
        </span>
        <span className="flex-1" />
        {seen ? <span className="shrink-0 font-semibold">vu</span> : null}
        <button
          type="button"
          data-testid="render-open"
          onClick={onOpen}
          className="shrink-0 cursor-pointer rounded-[6px] border border-border bg-white px-[8px] py-[2px] text-[11px] font-semibold text-text hover:bg-hover"
        >
          Agrandir
        </button>
        {onSeen ? (
          <button
            type="button"
            data-testid="render-seen-button"
            disabled={acking}
            onClick={onSeen}
            className={cx(
              'shrink-0 cursor-pointer rounded-[6px] px-[9px] py-[2px] text-[11px] font-semibold',
              acking ? 'bg-green-soft text-green' : 'bg-green text-white hover:brightness-95',
            )}
          >
            Vu
          </button>
        ) : null}
      </div>
      {/* un rendu non vu est affiché dans le panneau ; un rendu antérieur
          s'ouvre dans le popup (pas d'iframe par ligne plus ancienne) */}
      {seen ? null : (
        <div className="mt-[7px] overflow-hidden rounded-[7px]">
          <RenderFrame render={render} />
        </div>
      )}
    </div>
  );
}
