/**
 * Index local des messages : l'API OpenChamber ignore offset et curseurs et
 * refuse tout limit > 200 (renvoie 0, vérifié sur l'instance) : ses deux
 * extrémités laissent un angle mort central sur une longue conversation
 * (700 messages : ~300 centraux inaccessibles au vérificateur).
 *
 * Le daemon alimente donc un index local (table message_index, upsert
 * dédupliqué par id) : à chaque événement message.* d'une tâche, la fenêtre
 * glissante (asc 200 + desc 200) est réindexée ; au démarrage, backfill des
 * tâches de la flotte. L'index ne rétrécit JAMAIS : tout ce qui a coulé
 * pendant la vie du daemon est couvert, et la recherche du vérificateur
 * l'interroge en priorité (le listing reste le filet si l'index est vide).
 */
import { openchamberUrl } from './fleet.mts';
import { messageText } from './messages.mts';
import { indexedCount, logEvent, upsertIndexedMessages } from './state.mts';

const PAGE = 200;
const MAX_TEXT = 2000;        // par message dans l'index (la recherche n'a pas besoin de plus)
const MAX_TOOL_INPUTS = 4000; // par message, entrées de tool calls concaténées
const FLUSH_MS = 4000;

interface WirePart {
  type?: string;
  name?: string;
  tool?: string;
  state?: { input?: Record<string, unknown> };
}
interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  text?: string;
  content?: WirePart[];
  payload?: { text?: string };
}

/** Sessions à réindexer, dédupliquées : un flot d'événements = un seul fetch. */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** Appelé par la flotte sur tout événement message.* d'une session. */
export function noteMessageActivity(sessionId: unknown): void {
  const sid = String(sessionId ?? '');
  if (!sid.startsWith('ses_')) return;
  pending.add(sid);
  if (!timer) timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

async function flush(): Promise<void> {
  const ids = [...pending];
  pending.clear();
  for (const id of ids) {
    try { await refreshSession(id); } catch { /* reprise au prochain événement */ }
  }
}

async function jget(path: string, timeoutMs = 10_000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(openchamberUrl(path), { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function rowsOf(messages: WireMessage[]): Array<{
  msgId: string; at: number; type: string; text: string; toolInputs: string | null;
}> {
  const out: Array<{ msgId: string; at: number; type: string; text: string; toolInputs: string | null }> = [];
  for (const m of messages) {
    if (!m?.id) continue;
    const toolParts = (m.content ?? []).filter(p => p.type === 'tool');
    const toolInputs = toolParts.length
      ? toolParts.map(p => JSON.stringify(p.state?.input ?? {})).join('\n').slice(0, MAX_TOOL_INPUTS)
      : null;
    out.push({
      msgId: m.id,
      at: m.time?.created ?? 0,
      type: m.type ?? '?',
      text: messageText(m).slice(0, MAX_TEXT),
      toolInputs,
    });
  }
  return out;
}

/** Réindexe la fenêtre des deux extrémités (l'API ignore offset/curseurs). */
export async function refreshSession(sessionId: string): Promise<number> {
  const byId = new Map<string, WireMessage>();
  for (const order of ['asc', 'desc']) {
    try {
      const body = await jget(`/api/session/${sessionId}/message?limit=${PAGE}&order=${order}`) as { data?: WireMessage[] };
      for (const m of body.data ?? []) if (m?.id) byId.set(m.id, m);
    } catch { /* une extrémité manquante : garder l'autre */ }
  }
  const rows = rowsOf([...byId.values()]);
  if (rows.length) upsertIndexedMessages(sessionId, rows);
  return indexedCount(sessionId);
}

/** Backfill au démarrage et périodique : les tâches vivantes de la flotte. */
export function startIndexing(tasks: () => Array<{ id: string }>, everyMs = 5 * 60_000): void {
  const run = async () => {
    for (const t of tasks()) {
      try { await refreshSession(t.id); } catch { /* tâche éphémère ou instance lente */ }
    }
  };
  void run().catch(() => { /* le tick périodique reprendra */ });
  setInterval(() => void run().catch(() => { /* idem */ }), everyMs);
}

/** Journal compact de l'état d'indexation d'une tâche (diagnostic). */
export function indexStatus(sessionId: string): string {
  const n = indexedCount(sessionId);
  return n ? `${n} message(s) indexé(s)` : 'index vide (le listing reste le filet)';
}

/** Petit log d'amorçage, appelé après un backfill utile seulement en diagnostic. */
export function logIndexState(taskId: string): void {
  logEvent(taskId, 'note', `index messages : ${indexStatus(taskId)}`);
}
