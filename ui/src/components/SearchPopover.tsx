/**
 * Recherche des conversations (2026-11-14) : loupe du dashboard et popup.
 *
 * Le propriétaire perd une carte fermée en « Terminé » : le popup la retrouve
 * par son titre ou par un mot d'un de ses messages, puis la restaure. Le champ
 * interroge le daemon (catalogue des titres + index des messages OpenChamber) ;
 * la frappe est amortie et une requête en retard est annulée, jamais appliquée.
 *
 * Mise en page : le titre vient en premier (c'est l'identité qu'on cherche),
 * puis projet et dernière activité sur une ligne discrète (un même titre peut
 * exister dans deux projets), puis l'extrait trouvé, indenté sous un filet :
 * il explique pourquoi la conversation sort. L'action est alignée à droite de
 * la ligne de titre : « Restaurer » pour une carte fermée, « Voir » sinon.
 *
 * Le popup est un portail en position fixe (le tableau défile) et s'ouvre aussi
 * par Ctrl+Shift+K, choisi hors des bindings d'OpenChamber (mod+p, mod+f,
 * mod+k …, mod+shift+f, etc.).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { restoreConversation, searchConversations } from '../lib/api';
import { useFleetStore } from '../store/fleetStore';
import type { SearchResponse, SearchResult } from '../types';
import { SearchIcon } from './Icons';

/** Raccourci d'ouverture, documenté dans l'infobulle et le pied du popup. */
export const SEARCH_SHORTCUT = 'Ctrl+Shift+K';

const DEBOUNCE_MS = 220;

/** Date et heure de la dernière activité, dans la langue de la maquette. */
export function formatActivity(at: number, now = Date.now()): string {
  if (!at) return 'activité inconnue';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'activité inconnue';
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/** Rôle de l'auteur, en clair, pour l'extrait. */
export function roleLabel(role: string | undefined): string {
  if (role === 'user') return 'ton message';
  if (role === 'assistant') return 'réponse de l’agent';
  return 'message';
}

/** Une ligne de résultat, séparée pour le rendu statique des tests. */
export function SearchResultRow({
  result,
  now,
  restoring,
  onRestore,
  onReveal,
}: {
  result: SearchResult;
  now: number;
  restoring: boolean;
  onRestore: (sessionId: string) => void;
  onReveal: (sessionId: string) => void;
}) {
  const act = () => (result.closed ? onRestore(result.sessionId) : onReveal(result.sessionId));
  return (
    <div
      data-testid="search-result"
      data-session-id={result.sessionId}
      data-closed={result.closed ? '1' : '0'}
      role="button"
      tabIndex={0}
      onClick={act}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
      }}
      className="cursor-pointer rounded-[8px] border border-transparent px-[9px] py-[7px] hover:border-border hover:bg-hover"
    >
      <div className="flex items-start gap-[8px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-[6px]">
            <span
              data-testid="search-result-title"
              className="truncate text-[13px] font-semibold text-text"
            >
              {result.title}
            </span>
            {result.titleMatch ? (
              <span className="shrink-0 rounded-[4px] bg-green-soft px-[4px] text-[10px] font-semibold text-green">
                titre
              </span>
            ) : null}
            {result.closed ? (
              <span className="shrink-0 rounded-[4px] bg-orange-soft px-[4px] text-[10px] font-semibold text-attend">
                fermée
              </span>
            ) : null}
          </div>
          <div
            data-testid="search-result-meta"
            className="mt-[1px] truncate text-[11px] text-muted"
          >
            {result.project} · {formatActivity(result.at, now)}
          </div>
          {result.snippet?.length ? (
            <div
              data-testid="search-result-snippet"
              className="mt-[5px] border-l-2 border-border pl-[9px] text-[11.5px] leading-[1.45] text-muted"
            >
              <span className="mr-[5px] text-[10px] uppercase tracking-[.04em] text-placeholder">
                {roleLabel(result.role)}
              </span>
              {result.snippet.map((segment, index) =>
                segment.match ? (
                  <mark
                    key={index}
                    className="rounded-[2px] bg-orange-soft px-[1px] text-text"
                  >
                    {segment.text}
                  </mark>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          data-testid={result.closed ? 'search-restore' : 'search-reveal'}
          disabled={restoring}
          onClick={(e) => { e.stopPropagation(); act(); }}
          className={
            result.closed
              ? 'mt-[2px] shrink-0 cursor-pointer rounded-[6px] bg-green px-[9px] py-[3px] text-[11px] font-semibold text-white disabled:cursor-default disabled:opacity-60'
              : 'mt-[2px] shrink-0 cursor-pointer rounded-[6px] border border-border bg-white px-[9px] py-[3px] text-[11px] font-medium text-text hover:bg-hover'
          }
        >
          {result.closed ? (restoring ? 'Restauration…' : 'Restaurer') : 'Voir'}
        </button>
      </div>
    </div>
  );
}

/** Corps du popup (champ exclu), pour le rendu statique des tests. */
export function SearchResults({
  response,
  query,
  now,
  loading,
  restoring,
  onRestore,
  onReveal,
}: {
  response: SearchResponse | null;
  query: string;
  now: number;
  loading: boolean;
  restoring: string | null;
  onRestore: (sessionId: string) => void;
  onReveal: (sessionId: string) => void;
}) {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return (
      <div data-testid="search-hint" className="px-[10px] py-[14px] text-[12px] text-muted">
        Cherche un titre ou un mot d’un message. Les cartes fermées en « Terminé »
        se restaurent d’ici.
      </div>
    );
  }
  if (loading && !response) {
    return (
      <div data-testid="search-loading" className="px-[10px] py-[14px] text-[12px] text-muted">
        Recherche…
      </div>
    );
  }
  if (!response) return null;
  return (
    <div className="flex flex-col gap-[2px]">
      {response.state === 'unavailable' ? (
        <div
          data-testid="search-unavailable"
          className="mx-[9px] mb-[4px] rounded-[6px] bg-orange-soft px-[8px] py-[5px] text-[11px] leading-[1.4] text-attend"
        >
          L’index des messages d’OpenChamber ne répond pas : seuls les titres sont
          cherchés.
        </div>
      ) : null}
      {response.results.length ? (
        response.results.map((result) => (
          <SearchResultRow
            key={result.sessionId}
            result={result}
            now={now}
            restoring={restoring === result.sessionId}
            onRestore={onRestore}
            onReveal={onReveal}
          />
        ))
      ) : (
        <div data-testid="search-empty" className="px-[10px] py-[14px] text-[12px] text-muted">
          Aucune conversation ne correspond à « {trimmed} ».
        </div>
      )}
    </div>
  );
}

export function SearchPopover({
  now,
  onRestored,
  onReveal,
}: {
  now: number;
  onRestored: (sessionId: string) => void;
  onReveal: (sessionId: string) => void;
}) {
  const forgetClosed = useFleetStore((s) => s.forgetClosed);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Ouverture : champ vide et focus, comme une palette de commandes.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResponse(null);
    setError(null);
    setRestoring(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Frappe amortie ; la requête précédente est annulée.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    abortRef.current?.abort();
    abortRef.current = null;
    if (text.length < 2) {
      setResponse(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      searchConversations(text, controller.signal)
        .then((answer) => {
          if (controller.signal.aborted) return;
          setResponse(answer);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setError('Recherche impossible. Le daemon répond-il ?');
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  // Raccourci global d'ouverture (hors champs de saisie).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key !== 'K' && event.key !== 'k') return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Échap et clic extérieur ferment le popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target)) return;
      // le bouton bascule lui-même : le clic le referme proprement
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const restore = async (sessionId: string) => {
    if (restoring) return;
    setRestoring(sessionId);
    setError(null);
    try {
      await restoreConversation(sessionId);
      forgetClosed(sessionId);
      onRestored(sessionId);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Restauration impossible.');
    } finally {
      setRestoring(null);
    }
  };

  const reveal = (sessionId: string) => {
    onReveal(sessionId);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="search-button"
        aria-label={`Rechercher une conversation (${SEARCH_SHORTCUT})`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Rechercher une conversation (${SEARCH_SHORTCUT})`}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-text"
      >
        <SearchIcon />
      </button>

      {open
        ? createPortal(
            <div
              ref={dialogRef}
              role="dialog"
              aria-label="Rechercher une conversation"
              className="fixed left-1/2 top-[10vh] z-[300] flex w-[min(620px,calc(100vw-24px))] max-h-[72vh] -translate-x-1/2 flex-col overflow-hidden rounded-[10px] border border-border bg-card text-left shadow-[0_14px_40px_rgba(0,0,0,.20)]"
            >
              <div className="flex items-center gap-[8px] border-b border-border px-[11px] py-[9px]">
                <span className="shrink-0 text-muted">
                  <SearchIcon size={15} />
                </span>
                <input
                  ref={inputRef}
                  data-testid="search-input"
                  type="text"
                  value={query}
                  placeholder="Titre ou mot d’un message…"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-text outline-none placeholder:text-placeholder"
                />
                <span className="shrink-0 rounded-[4px] border border-border px-[4px] py-[1px] text-[10px] text-muted">
                  Échap
                </span>
              </div>

              {error ? (
                <div
                  data-testid="search-error"
                  role="status"
                  className="mx-[9px] mt-[6px] rounded-[6px] bg-orange-soft px-[8px] py-[5px] text-[11px] leading-[1.4] text-attend"
                >
                  {error}
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto px-[3px] py-[5px]">
                <SearchResults
                  response={response}
                  query={query}
                  now={now}
                  loading={loading}
                  restoring={restoring}
                  onRestore={(sessionId) => void restore(sessionId)}
                  onReveal={reveal}
                />
              </div>

              <div className="flex items-center justify-between border-t border-border px-[11px] py-[5px] text-[10.5px] text-muted">
                <span>
                  Titres et messages des conversations
                </span>
                <span className="flex items-center gap-[4px]">
                  <kbd className="rounded-[3px] border border-border px-[3px] py-[1px] text-[10px]">
                    {SEARCH_SHORTCUT}
                  </kbd>
                  pour ouvrir
                </span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
