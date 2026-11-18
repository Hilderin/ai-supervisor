/**
 * Fin de tour PROUVÉE par la conversation.
 *
 * `/api/sessions/status` d'OpenChamber est une carte en mémoire alimentée par
 * les seuls événements de statut d'OpenCode. Un tour stoppé pendant qu'une
 * question attend n'en produit aucun : OpenCode 2.2.5 termine l'étape en erreur
 * (`aborted` / « Step interrupted »), laisse le message assistant COMPLET avec
 * cette erreur, puis annonce l'arrêt comme `session.execution.interrupted`
 * avec `reason: "shutdown"` — motif qu'OpenChamber ignore volontairement, parce
 * qu'un vrai shutdown, lui, reprend le tour après redémarrage (mesuré le
 * 2026-11-17, session « Application démo ludique », ses_e16b2d9c7ffe89LQJqtiq73JF8).
 *
 * Résultat : l'entrée reste `busy` jusqu'à l'expiration de 24 h, et la carte du
 * Superviseur affiche un spinner, « Réflexion en cours... » et refuse l'état
 * terminé pour un tour qui est fini (le message est complet, OpenCode ne liste
 * plus la session dans /api/session/active).
 *
 * La conversation porte la preuve, on la lit donc pour les seules cartes que
 * `/api/sessions/status` dit en cours. On ne corrige QUE ce cas : un tour
 * réellement actif n'a pas d'erreur d'abandon sur son dernier message, et un
 * échec de provider (retry) garde son statut.
 */

/** Message de conversation tel que rendu par `/api/session/:id/message`. */
export interface TailMessage {
  id?: string;
  type?: string;
  time?: { created?: number; completed?: number };
  error?: unknown;
  outcome?: string;
}

/** Une carte à vérifier : ce que la flotte sait déjà de la session. */
export interface SettleCandidate {
  id: string;
  status: string;
  lastUpdateAt?: number;
}

/** Types d'erreur d'OpenCode qui signifient « l'utilisateur a stoppé ». */
const STOPPED_ERROR_TYPES = new Set(['aborted', 'messageabortederror']);

/**
 * Détails entiers d'un arrêt. Seul le détail COMPLET compte : une coupure de
 * flux dit « Connection aborted » ou « Stream aborted by the provider », ce qui
 * est un échec, pas un arrêt (même règle que `isStoppedTurnError` côté
 * OpenChamber, packages/ui/src/lib/messages/assistantError.ts).
 */
const STOPPED_ERROR_DETAILS = new Set(['aborted', 'step interrupted']);

const TAIL_LIMIT = 8;
const TAIL_TIMEOUT_MS = 4_000;

function oneLine(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

/**
 * L'erreur d'un message assistant dit-elle que le tour a été stoppé ?
 * Accepte la forme structurée `{type|name, message}` et la chaîne nue.
 */
export function isStoppedTurnError(error: unknown): boolean {
  if (typeof error === 'string') return STOPPED_ERROR_DETAILS.has(oneLine(error));
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
  const name = typeof record.name === 'string' ? record.name.trim().toLowerCase() : '';
  if (STOPPED_ERROR_TYPES.has(type) || STOPPED_ERROR_TYPES.has(name)) return true;
  const message = typeof record.message === 'string' ? record.message : '';
  return STOPPED_ERROR_DETAILS.has(oneLine(message));
}

/**
 * La queue de la conversation prouve-t-elle que le tour est fini ?
 *
 * On descend du message le plus récent : un message `user` après le dernier
 * tour assistant signifie qu'un nouveau tour a commencé (rien à corriger) ; un
 * enregistrement `idle` est la fin de tour écrite par OpenCode ; un message
 * assistant dont l'erreur est un arrêt la prouve aussi. Un message assistant
 * complet SANS erreur ne prouve rien : un tour enchaîne plusieurs étapes.
 */
export function turnEndedFromTail(messages: TailMessage[]): boolean {
  const ordered = [...messages].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
  for (const message of ordered) {
    const type = message.type;
    if (type === 'user') return false;
    if (type === 'idle') return true;
    if (type === 'assistant') return isStoppedTurnError(message.error);
  }
  return false;
}

/** Décisions déjà prises, par session et par version de statut. */
const decisions = new Map<string, { at: number; ended: boolean }>();

/** Pour les tests : oublie les décisions mémorisées. */
export function resetTurnEndCache(): void {
  decisions.clear();
}

async function readTail(base: string, sessionId: string): Promise<TailMessage[] | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAIL_TIMEOUT_MS);
  try {
    const url = `${base}/api/session/${encodeURIComponent(sessionId)}/message?limit=${TAIL_LIMIT}&order=desc`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: TailMessage[] };
    return Array.isArray(body?.data) ? body.data : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Corrige `status` en `idle` pour les cartes dont la conversation prouve que le
 * tour est fini. Lecture bornée et mémorisée par `lastUpdateAt` : une session
 * qui bouge (vrai tour) est relue, une session figée ne l'est qu'une fois.
 * Instance injoignable ou réponse illisible : on ne décide rien.
 *
 * `settled` = les cartes corrigées dans CET appel (le tri doit suivre) ;
 * `fresh` = celles dont la décision vient d'être prise (une seule fois par
 * version de statut : le journal ne se répète pas à chaque poll).
 */
export interface SettleResult {
  settled: string[];
  fresh: string[];
}

export async function settleStoppedTurns(rows: SettleCandidate[], base: string): Promise<SettleResult> {
  const settled: string[] = [];
  const fresh: string[] = [];
  const busy = rows.filter((row) => row.status === 'busy' || row.status === 'retry');
  const keep = new Set(busy.map((row) => row.id));
  for (const id of decisions.keys()) {
    if (!keep.has(id)) decisions.delete(id);
  }
  for (const row of busy) {
    const at = row.lastUpdateAt ?? 0;
    let decision = decisions.get(row.id);
    if (!decision || decision.at !== at) {
      const tail = await readTail(base, row.id);
      if (!tail) continue; // instance muette : on ne décide rien
      decision = { at, ended: turnEndedFromTail(tail) };
      decisions.set(row.id, decision);
      if (decision.ended) fresh.push(row.id);
    }
    if (!decision.ended) continue;
    row.status = 'idle';
    settled.push(row.id);
  }
  return { settled, fresh };
}
