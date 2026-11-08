import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clampIndex, stepIndex, type GalleryImage } from '../lib/evidenceGallery';
import { cx } from '../lib/cx';

interface Props {
  images: GalleryImage[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}

const NAV_BTN =
  'absolute top-1/2 flex h-[38px] w-[38px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/12 pb-[2px] text-[24px] leading-none text-white outline-none transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-white/12';

const CLOSE_BTN =
  'flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-transparent text-[19px] leading-none text-white/70 outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60';

interface PanelProps {
  image: GalleryImage;
  index: number;
  total: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** le clic hors de l'image ferme */
  onBackdrop: () => void;
  panelRef?: React.Ref<HTMLDivElement>;
}

/**
 * Contenu de la visionneuse, hors portail : testable en rendu statique.
 * L'image est contenue (`object-contain`) dans l'espace restant : jamais
 * déformée ni rognée. Les boutons restent dans les marges sombres.
 */
export function EvidenceViewerPanel({ image, index, total, onIndex, onClose, onBackdrop, panelRef }: PanelProps) {
  const previous = stepIndex(index, -1, total);
  const next = stepIndex(index, 1, total);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Visionneuse des preuves"
      tabIndex={-1}
      data-testid="evidence-viewer"
      onClick={onBackdrop}
      className="fixed inset-0 z-[500] flex flex-col bg-[rgba(13,17,14,0.9)] px-[14px] py-[10px] outline-none"
    >
      <div className="flex shrink-0 items-center gap-[8px]">
        <span
          data-testid="evidence-viewer-criterion"
          title={`${image.ref} · ${image.title}`}
          className="min-w-0 truncate text-[12px] text-white/85"
        >
          <span className="font-mono text-[11px] font-semibold">{image.ref}</span>
          <span className="mx-[6px] text-white/40">·</span>
          <span>{image.title}</span>
        </span>
        <span className="flex-1" />
        <span
          data-testid="evidence-viewer-position"
          aria-live="polite"
          className="shrink-0 text-[11.5px] tabular-nums text-white/60"
        >
          {index + 1} / {total}
        </span>
        <button
          type="button"
          data-testid="evidence-viewer-close"
          aria-label="Fermer la visionneuse"
          title="Fermer la visionneuse (Échap)"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={CLOSE_BTN}
        >
          ×
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-[46px] py-[10px]">
        <img
          src={image.src}
          alt={image.alt}
          data-testid="evidence-viewer-image"
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-[6px] object-contain shadow-[0_12px_44px_rgba(0,0,0,0.55)]"
        />
        <button
          type="button"
          data-testid="evidence-viewer-prev"
          aria-label="Image précédente"
          title="Image précédente (flèche gauche)"
          disabled={previous == null}
          onClick={(e) => {
            e.stopPropagation();
            if (previous != null) onIndex(previous);
          }}
          className={cx(NAV_BTN, 'left-[2px]')}
        >
          ‹
        </button>
        <button
          type="button"
          data-testid="evidence-viewer-next"
          aria-label="Image suivante"
          title="Image suivante (flèche droite)"
          disabled={next == null}
          onClick={(e) => {
            e.stopPropagation();
            if (next != null) onIndex(next);
          }}
          className={cx(NAV_BTN, 'right-[2px]')}
        >
          ›
        </button>
      </div>

      <div className="flex shrink-0 justify-center px-[46px]">
        <span className="min-w-0 truncate text-center text-[11px] text-white/50" title={image.text}>
          {image.text}
        </span>
      </div>
    </div>
  );
}

/**
 * Visionneuse plein écran des captures de preuve d'une tâche, en portail sur
 * `document.body` : le détail n'est pas démonté, sa position de lecture reste
 * intacte. Échap et les flèches sont écoutées en capture pour couper l'événement
 * avant le gestionnaire du panneau (qui ferme le détail sur Échap).
 */
export function EvidenceViewer({ images, index, onIndex, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current = clampIndex(index, images.length);

  // le focus va dans la visionneuse et revient sur la miniature d'origine
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // la flèche ne défile pas le détail derrière la superposition
        e.preventDefault();
        e.stopPropagation();
        const target = stepIndex(index, e.key === 'ArrowLeft' ? -1 : 1, images.length);
        if (target != null) onIndex(target);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [index, images.length, onIndex, onClose]);

  if (current < 0) return null;
  return createPortal(
    <EvidenceViewerPanel
      panelRef={panelRef}
      image={images[current]}
      index={current}
      total={images.length}
      onIndex={onIndex}
      onClose={onClose}
      onBackdrop={onClose}
    />,
    document.body,
  );
}
