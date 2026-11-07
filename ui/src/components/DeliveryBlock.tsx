import { memo, useEffect, useState, type ReactNode } from 'react';
import { fetchDelivery } from '../lib/api';
import { cx } from '../lib/cx';
import { deliveryView, isLongDelivery } from '../lib/delivery';
import { RENDER_MAX_HEIGHT } from '../lib/renderDoc';
import type { Delivery } from '../types';
import { DeliveryMarkdown } from './DeliveryMarkdown';
import { SandboxedRender } from './SandboxedRender';

interface Props {
  sessionId: string;
  /** faux pour une carte busy ou en attente : on ne lit pas les messages */
  enabled: boolean;
  /** carte TERMINÉ : une absence de réponse est affichée explicitement */
  done: boolean;
  /** change quand le tour ou la dernière activité change (refetch ciblé) */
  refreshKey: string;
  /** aperçu de 2 lignes dans la carte ; le détail complet vit dans l'inspecteur */
  compact?: boolean;
  /** déplié d'office dans l'inspecteur : pas de « Voir plus » à cliquer d'abord */
  defaultExpanded?: boolean;
}

function Shell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="mt-[10px] rounded-[9px] border border-border bg-render px-[12px] py-[10px]">
      <div className="mb-[8px] flex items-center gap-[8px]">
        <span className="shrink-0 text-[12px] font-semibold text-muted">Résultat</span>
        {title ? <span className="min-w-0 truncate text-[11.5px] text-muted opacity-80">{title}</span> : null}
        <span className="flex-1" />
      </div>
      {children}
    </div>
  );
}

/**
 * Livraison inline : dernier texte de l'agent + page `openchamber_render`.
 * Le fetch est à la demande (route dédiée), jamais dans les frames de flotte.
 * Le composant est mémoïsé : les re-rendus 1 s / 2 s de la carte ne relancent
 * ni la requête ni le parsing du markdown.
 */
export const DeliveryBlock = memo(function DeliveryBlock({ sessionId, enabled, done, refreshKey, compact = false, defaultExpanded = false }: Props) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [sessionId, refreshKey, defaultExpanded]);

  useEffect(() => {
    if (!enabled) {
      setDelivery(null);
      setLoading(false);
      setError(false);
      return;
    }
    const ctl = new AbortController();
    let alive = true;
    setLoading(true);
    setError(false);
    fetchDelivery(sessionId, ctl.signal)
      .then((d) => { if (alive) setDelivery(d); })
      .catch((e) => {
        if (!alive || (e as Error)?.name === 'AbortError') return;
        setDelivery(null);
        setError(true);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ctl.abort(); };
  }, [sessionId, enabled, refreshKey, attempt]);

  const view = deliveryView({ enabled, loading, error, delivery, done });
  if (view === 'hidden') return null;

  if (compact) {
    if (view === 'loading') {
      return <div className="text-[11.5px] text-muted">Chargement du résultat…</div>;
    }
    if (view === 'empty') {
      return done ? <div className="text-[11.5px] text-muted">Aucune réponse textuelle pour ce tour.</div> : null;
    }
    if (view === 'error' || !delivery) {
      return <div className="text-[11.5px] text-muted">Résultat indisponible.</div>;
    }
    return (
      <div className="max-h-[42px] overflow-hidden pb-[3px] text-[11.5px] leading-[1.4] text-muted">
        {delivery.render?.title ? (
          <div className="truncate font-semibold">{delivery.render.title}</div>
        ) : null}
        {delivery.markdown ? <DeliveryMarkdown markdown={delivery.markdown} sessionId={sessionId} /> : null}
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <Shell>
        <div className="text-[12px] text-muted">Chargement du résultat…</div>
      </Shell>
    );
  }
  if (view === 'empty') {
    return (
      <Shell>
        <div className="text-[12px] text-muted">Aucune réponse textuelle pour ce tour.</div>
      </Shell>
    );
  }
  if (view === 'error' || !delivery) {
    return (
      <Shell>
        <div className="flex items-center gap-[8px] text-[12px] text-muted">
          <span>Résultat indisponible.</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="cursor-pointer text-[11.5px] font-semibold text-green hover:underline"
          >
            Réessayer
          </button>
        </div>
      </Shell>
    );
  }

  const markdown = delivery.markdown ?? '';
  // TERMINÉ : aperçu généreux (280 px). Carte au repos non terminée : aperçu
  // compact (3 lignes) pour que la flotte reste scannable ; un clic déplie.
  const long = (done ? isLongDelivery(markdown) : (markdown.length > 180 || markdown.split('\n').length > 4))
    || (!done && !!delivery.render);
  const preview = !done && !expanded;
  const maxRenderHeight = preview ? 160 : RENDER_MAX_HEIGHT;

  return (
    <Shell title={delivery.render?.title}>
      {delivery.render ? (
        <div className="mb-[8px] overflow-hidden rounded-[7px]">
          <SandboxedRender html={delivery.render.html} title={delivery.render.title} maxHeight={maxRenderHeight} />
        </div>
      ) : null}

      {markdown ? (
        <div
          className={cx(
            'relative',
            preview && long && 'max-h-[72px] overflow-hidden',
            !preview && long && !expanded && 'max-h-[280px] overflow-hidden',
          )}
        >
          <DeliveryMarkdown markdown={markdown} sessionId={sessionId} />
          {long && !expanded && markdown ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[36px] bg-gradient-to-t from-render to-transparent" />
          ) : null}
        </div>
      ) : null}
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-[5px] cursor-pointer text-[11.5px] font-semibold text-green hover:underline"
        >
          {expanded ? 'Voir moins' : 'Voir plus'}
        </button>
      ) : null}

      {delivery.truncated ? (
        <div className="mt-[6px] text-[11px] text-muted">
          Réponse tronquée à 40 000 caractères.
        </div>
      ) : null}
    </Shell>
  );
});
