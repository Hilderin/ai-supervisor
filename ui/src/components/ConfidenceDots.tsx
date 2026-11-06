import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confidenceColor, confidenceLevel } from '../lib/fleet';

interface Props {
  conf: number | null;
  note?: string;
}

/** Largeur max de la bulle : au-delà, le texte se replie au lieu de s'étirer. */
const MAX_WIDTH = 300;
/** Espace entre les pastilles et la bulle. */
const GAP = 8;
/** Marge minimale avec les bords de la fenêtre. */
const MARGIN = 8;

/**
 * Trois pastilles de confiance + bulle HTML (confidence_reason), ouverte au survol
 * et au focus clavier.
 *
 * La bulle vit dans un portail en position fixe : laissée dans la carte, une bulle
 * absolue se dimensionne par rapport aux pastilles (une trentaine de pixels de large),
 * et le texte se retrouvait replié sur trois ou quatre lettres par ligne.
 */
export function ConfidenceDots({ conf, note }: Props) {
  const level = confidenceLevel(conf);
  const color = confidenceColor(conf);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = hover || focus;

  // Position calculée après le montage de la bulle (il faut sa taille réelle).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const left = Math.min(
        Math.max(MARGIN, anchor.right - tip.width),
        window.innerWidth - tip.width - MARGIN,
      );
      let top = anchor.top - tip.height - GAP;
      if (top < MARGIN) {
        top = Math.min(anchor.bottom + GAP, window.innerHeight - tip.height - MARGIN);
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
  }, [open, conf, note]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocus(false);
        setHover(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const title = conf == null ? 'Confiance non disponible' : `Confiance ${Math.round(conf * 100)} %`;

  return (
    <span
      ref={anchorRef}
      role="img"
      tabIndex={0}
      aria-label={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className="relative flex shrink-0 cursor-default items-center gap-[3px] rounded-[4px] p-[4px] outline-none focus-visible:ring-2 focus-visible:ring-green/40"
    >
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className="block h-[7px] w-[7px] rounded-full"
          style={{ background: i < level ? (color ?? undefined) : '#dcdedd' }}
        />
      ))}

      {open
        ? createPortal(
            <div
              ref={tipRef}
              role="tooltip"
              style={{
                position: 'fixed',
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                width: 'max-content',
                maxWidth: MAX_WIDTH,
                visibility: pos ? 'visible' : 'hidden',
              }}
              className="pointer-events-none z-[200] rounded-[9px] bg-ink px-[11px] py-[9px] text-left text-[12.5px] leading-[1.5] text-white shadow-[0_8px_22px_rgba(0,0,0,.22)] [overflow-wrap:anywhere]"
            >
              <b>{title}</b>
              {note ? (
                <>
                  <br />
                  {note}
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
