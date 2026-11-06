import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { RENDER_MAX_HEIGHT, RENDER_MIN_HEIGHT, buildRenderDocument } from '../lib/renderDoc';

interface Props {
  html: string;
  title: string;
  /** hauteur maximale (l'iframe défile au-delà) */
  maxHeight?: number;
}

/**
 * Page `openchamber_render` dans une iframe sandboxée : pas de
 * `allow-same-origin`, donc origine opaque et aucun accès au Superviseur.
 * La CSP injectée coupe le réseau ; la hauteur est rapportée par la page et
 * plafonnée (au-delà, l'iframe défile).
 */
export const SandboxedRender = memo(function SandboxedRender({ html, title, maxHeight = RENDER_MAX_HEIGHT }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(Math.min(240, maxHeight));
  const doc = useMemo(() => buildRenderDocument(html), [html]);

  // replier l'aperçu (maxHeight qui baisse) ne doit pas laisser l'iframe haute
  useEffect(() => {
    setHeight((h) => Math.min(h, maxHeight));
  }, [maxHeight]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type !== 'superviseur:render-height' || typeof data.height !== 'number') return;
      if (!Number.isFinite(data.height)) return;
      setHeight(Math.max(RENDER_MIN_HEIGHT, Math.min(maxHeight, Math.ceil(data.height))));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [maxHeight]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={doc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      scrolling={height >= maxHeight ? 'auto' : 'no'}
      className="block w-full border-0 bg-transparent"
      style={{ height: Math.min(height, maxHeight) }}
    />
  );
});
