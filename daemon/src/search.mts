/**
 * Recherche dans les conversations, pour retrouver une carte fermée (2026-11-14).
 *
 * Deux sources, fusionnées par conversation (voir search-core.mts pour la
 * fusion, testable sans instance) :
 * 1. les TITRES du catalogue OpenChamber (`sessionCatalog`, lu par le poll de
 *    flotte) : sous-chaîne, accents et casse ignorés ;
 * 2. les MESSAGES de l'index d'OpenChamber (`GET /api/openchamber/message-search`,
 *    activé côté instance) : on ne relit pas les conversations une par une.
 *
 * L'index encadre les correspondances de deux caractères privés (U+E000 /
 * U+E001) : `parseSnippet` les transforme en segments, l'UI les dessine en
 * surbrillance sans jamais injecter de HTML.
 *
 * Le module ne fait aucune écriture sauf `restoreConversation`, qui rouvre une
 * carte fermée (même geste que la réouverture automatique sur activité).
 */
import { sessionCatalog, type OpenchamberSession } from './fleet.mts';
import { closedTaskIds, logEvent, reopenTaskState } from './state.mts';
import { SUPERVISOR_DIR } from './supervisor.mts';
import {
  mergeSearch,
  normalizeForSearch,
  SEARCH_MIN_CHARS,
  type MessageHit,
  type SearchResult,
} from './search-core.mts';

export {
  mergeSearch,
  normalizeForSearch,
  parseSnippet,
  SEARCH_MAX_RESULTS,
  SEARCH_MIN_CHARS,
} from './search-core.mts';
export type { MessageHit, SearchResult, SearchSession, SnippetSegment } from './search-core.mts';

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

/** Pages lues dans l'index des messages avant fusion. */
const MESSAGE_LIMIT = 30;

export interface SearchAnswer {
  /** `unavailable` : l'index des messages n'a pas répondu (titres seuls) */
  state: 'ok' | 'too_short' | 'unavailable';
  results: SearchResult[];
}

/**
 * Recherche complète : titres du catalogue + messages de l'index OpenChamber.
 * `sessions` et `closed` sont injectables pour les tests.
 */
export async function searchConversations(
  query: string,
  options: { sessions?: OpenchamberSession[]; closed?: Set<string> } = {},
): Promise<SearchAnswer> {
  const text = String(query ?? '').trim();
  if (normalizeForSearch(text).length < SEARCH_MIN_CHARS) return { state: 'too_short', results: [] };
  const sessions = options.sessions ?? sessionCatalog();
  const closed = options.closed ?? closedTaskIds();
  let state: SearchAnswer['state'] = 'ok';
  let hits: MessageHit[] = [];
  if (base) {
    try {
      const res = await fetch(
        `${base}/api/openchamber/message-search?q=${encodeURIComponent(text)}&limit=${MESSAGE_LIMIT}`,
      );
      if (res.status === 503) {
        state = 'unavailable';
      } else if (res.ok) {
        const body = await res.json() as { hits?: MessageHit[] };
        hits = Array.isArray(body?.hits) ? body.hits : [];
      } else {
        state = 'unavailable';
      }
    } catch {
      state = 'unavailable';
    }
  } else {
    state = 'unavailable';
  }
  return {
    state,
    results: mergeSearch({
      query: text,
      sessions,
      hits,
      closed,
      excludeDirs: [SUPERVISOR_DIR],
    }),
  };
}

/**
 * Remet une carte fermée dans le tableau : même geste que la réouverture
 * automatique (activité postérieure à la fermeture), déclenché par le
 * propriétaire depuis la recherche.
 */
export function restoreConversation(
  sessionId: string,
  sessions: OpenchamberSession[] = sessionCatalog(),
): { ok: boolean; error?: 'session_gone' } {
  const id = String(sessionId ?? '').trim();
  const known = sessions.find(
    (session) => session.id === id && !session.parentID && !session.time?.archived,
  );
  if (!known) return { ok: false, error: 'session_gone' };
  reopenTaskState(id);
  logEvent(id, 'note', 'restaurée dans le tableau depuis la recherche');
  return { ok: true };
}
