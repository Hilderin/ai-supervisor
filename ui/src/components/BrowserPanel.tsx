import { useEffect, useRef, useState } from 'react';
import {
  browserPanelBridge,
  normalizeBrowserAddress,
  type BrowserPanelState,
} from '../lib/browserPanel';
import { cx } from '../lib/cx';

interface Props {
  onClose: () => void;
}

/**
 * Panneau navigateur du composant.
 *
 * La page n'est pas rendue ici : c'est une vue native (WebContentsView) que le
 * main process pose exactement sur l'élément `host`. L'UI fournit le rectangle,
 * envoie l'adresse et reçoit l'état (URL, titre, historique, port CDP publié).
 * Une seule page, volontairement : c'est celle que les agents pilotent.
 */
export function BrowserPanel({ onClose }: Props) {
  const bridge = browserPanelBridge();
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<BrowserPanelState | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hasPage = Boolean(state?.url);

  // état initial + suivi des événements du composant (navigation de l'agent incluse)
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.state().then((next) => {
      if (!alive || !next) return;
      setState(next);
      if (next.url && document.activeElement !== inputRef.current) setDraft(next.url);
    });
    return bridge.onState((next) => {
      setState(next);
      // ne jamais écraser ce que le propriétaire est en train de taper
      if (next.url && document.activeElement !== inputRef.current) setDraft(next.url);
    });
  }, [bridge]);

  // rectangle de la vue native : il suit l'élément, la fenêtre et le défilement
  useEffect(() => {
    if (!bridge) return;
    const host = hostRef.current;
    if (!host) return;
    const send = () => {
      const rect = host.getBoundingClientRect();
      void bridge.layout({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: hasPage && rect.width >= 1 && rect.height >= 1,
      });
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(host);
    window.addEventListener('resize', send);
    window.addEventListener('scroll', send, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', send);
      window.removeEventListener('scroll', send, true);
    };
  }, [bridge, hasPage]);

  // quitter le panneau cache la vue sans détruire la page (on la retrouve intacte)
  useEffect(() => () => { if (bridge) void bridge.action('hide'); }, [bridge]);

  const open = async (value: string) => {
    const target = normalizeBrowserAddress(value);
    if (!bridge) return;
    if (!target) {
      setError('adresse http(s) attendue');
      return;
    }
    setError(null);
    const next = await bridge.navigate(target);
    if (next) {
      setState(next);
      if (next.error === 'invalid_url') setError('adresse refusée par le composant');
      else setDraft(next.url || target);
    }
  };

  const action = async (name: 'reload' | 'back' | 'forward') => {
    if (!bridge) return;
    const next = await bridge.action(name);
    if (next) setState(next);
  };

  return (
    <section data-testid="browser-panel" className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card">
      <header className="flex h-[36px] shrink-0 items-center gap-[6px] border-b border-border px-[8px]">
        <span title={state?.title || 'Navigateur'} className="min-w-0 max-w-[150px] truncate text-[12px] font-semibold text-text">
          {state?.title || 'Navigateur'}
        </span>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="Page précédente"
            title="Page précédente"
            disabled={!state?.canGoBack}
            onClick={() => void action('back')}
            className="flex h-[22px] w-[20px] cursor-pointer items-center justify-center rounded-[5px] text-[14px] leading-none text-muted hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            aria-label="Page suivante"
            title="Page suivante"
            disabled={!state?.canGoForward}
            onClick={() => void action('forward')}
            className="flex h-[22px] w-[20px] cursor-pointer items-center justify-center rounded-[5px] text-[14px] leading-none text-muted hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            aria-label="Recharger la page"
            title="Recharger la page"
            disabled={!hasPage}
            onClick={() => void action('reload')}
            className="flex h-[22px] w-[20px] cursor-pointer items-center justify-center rounded-[5px] text-[13px] leading-none text-muted hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">⟳</span>
          </button>
        </div>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            void open(draft);
          }}
        >
          <input
            ref={inputRef}
            type="text"
            aria-label="Adresse de la page"
            placeholder="http://localhost:3000"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="h-[24px] w-full rounded-[6px] border border-border bg-bg px-[8px] text-[11.5px] text-text outline-none focus:border-green"
          />
        </form>
        {state?.port ? (
          <span
            title={`Port CDP publié pour les agents : ${state.cdpUrl ?? ''}`}
            className={cx(
              'shrink-0 rounded-[5px] px-[6px] py-[2px] text-[10.5px]',
              'bg-green-soft text-green',
            )}
          >
            CDP {state.port}
          </span>
        ) : null}
        <button
          type="button"
          aria-label="Fermer le panneau navigateur"
          title="Fermer le panneau navigateur"
          onClick={onClose}
          className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-[18px] leading-none text-muted hover:bg-hover hover:text-text"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {!bridge ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-[16px] text-center text-[12px] text-muted">
          Le panneau navigateur nécessite l’application de bureau : le navigateur appartient au composant, une page web ne peut pas le posséder.
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-bg">
          {/* la vue native se pose sur cet élément */}
          <div ref={hostRef} data-testid="browser-panel-host" className="absolute inset-0" />
          {!hasPage ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[6px] p-[16px] text-center">
              <span className="text-[12px] text-text">Aucune page ouverte.</span>
              <span className="max-w-[300px] text-[11px] text-muted">
                Saisis une adresse : la page vit dans le navigateur du Superviseur, et une tâche peut s’y rattacher par CDP pour la voir et la piloter.
              </span>
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="absolute inset-x-0 bottom-0 bg-orange-soft px-[10px] py-[6px] text-[11px] text-attend">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
