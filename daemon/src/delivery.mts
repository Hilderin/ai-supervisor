/**
 * Livraison inline : le dernier résultat de l'agent pour une session.
 *
 * Chemin de données volontairement à la demande : la flotte (GET + SSE 2x/s)
 * ne porte pas les messages. L'UI demande cette route quand une carte est au
 * repos ou terminée, et le daemon garde un petit cache invalidé par les
 * événements OpenChamber (`message.*`, `session.execution.*`, `session.text.*`,
 * `session.step.ended`, `session.idle`, `session.inbox.*`).
 *
 * Contrat observé sur l'instance réelle (`GET /api/session/:id/message`) :
 * - les messages sont renvoyés du plus récent au plus ancien par défaut ;
 * - le prompt humain est à la racine (`text`), la réponse assistant dans
 *   `content[]` avec des parts `text`, `reasoning` et `tool` ;
 * - un tool part porte `name` (ou `tool`), `state.status`, `state.input`,
 *   `state.metadata` et, une fois fini, `state.content[]` (pas `output`).
 * - `openchamber_render` garde sa page dans `state.input.parameters.html`
 *   (ou `state.input.html`), son titre au même endroit, et confirme le rendu
 *   avec `state.metadata.openchamber.ok`.
 *
 * Le daemon ne rend jamais le HTML : il le transmet tel quel, l'UI l'affiche
 * dans une iframe sandboxée sans `allow-same-origin` et avec une CSP.
 */

export interface DeliveryRender {
  html: string;
  title: string;
}

export interface Delivery {
  sessionId: string;
  /** horodatage de la lecture (pas du message) */
  at: number;
  state: 'ok' | 'empty' | 'unavailable';
  messageId?: string;
  /** date du dernier texte ou rendu retenu */
  createdAt?: number;
  /** début du tour courant (dernier message humain) */
  turnStartedAt?: number;
  markdown?: string;
  render?: DeliveryRender;
  /** le texte a été coupé à MAX_MARKDOWN */
  truncated?: boolean;
  error?: string;
}

interface WirePart {
  type?: string;
  text?: string;
  tool?: string;
  name?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    content?: unknown;
  };
}

interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  text?: string;
  payload?: { text?: string };
  content?: WirePart[];
}

const MESSAGE_LIMIT = 40;
const MAX_MARKDOWN = 40_000;
const MAX_HTML = 200_000;
const CACHE_TTL_MS = 30_000;
const EMPTY_TTL_MS = 5_000;
const ERROR_TTL_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;

let base = '';
export function setBase(b: string) {
  base = b.replace(/\/$/, '');
}

const cache = new Map<string, { value: Delivery; at: number }>();
const inFlight = new Map<string, { gen: string; promise: Promise<Delivery> }>();
// générations : une invalidation pendant un fetch empêche de mettre en cache
// une réponse déjà périmée (course event ↔ lecture)
const generations = new Map<string, number>();
let globalGeneration = 0;

function generationOf(id: string): string {
  return `${globalGeneration}:${generations.get(id) ?? 0}`;
}

/** Les événements OpenChamber qui peuvent changer la livraison d'une session. */
export function deliveryEventRelevant(type: string): boolean {
  return /^message\./.test(type)
    || /^session\.(execution\.|inbox\.|text\.|step\.ended$|idle$)/.test(type);
}

/**
 * Invalide le cache. Avec un id : une seule session ; sans : tout (un événement
 * sans sessionID exploitable ne doit pas laisser une carte figée).
 */
export function invalidateDelivery(sessionId?: string) {
  if (sessionId) {
    cache.delete(sessionId);
    generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  } else {
    cache.clear();
    globalGeneration += 1;
  }
}

/** Réservé aux tests : vide aussi les requêtes en vol. */
export function resetDeliveryCache() {
  cache.clear();
  inFlight.clear();
  generations.clear();
  globalGeneration += 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOf(m: WireMessage): string {
  const parts = Array.isArray(m.content) ? m.content : [];
  const fromParts = parts
    .filter(p => p?.type === 'text')
    .map(p => p.text ?? '')
    .join('\n\n')
    .trim();
  return fromParts || (m.text ?? '').trim() || (m.payload?.text ?? '').trim();
}

function isRenderTool(name: unknown): boolean {
  const n = String(name ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  return n === 'openchamber_render' || (n.includes('openchamber') && n.endsWith('render'));
}

const TITLE_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ',
};

function titleFromHtml(html: string): string {
  const element = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => TITLE_ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
  return (element(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
    || element(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)
    || 'Rendu de l’agent').slice(0, 120);
}

/** La page d'un appel `openchamber_render` terminé, ou null. */
export function renderOf(part: WirePart): DeliveryRender | null {
  if (part?.type !== 'tool') return null;
  const st = part.state;
  if (!st || st.status !== 'completed') return null;
  const input = asRecord(st.input) ?? {};
  // le nom suffit sur la version installée ; `action: render.page` couvre une
  // éventuelle forme générique du tool (openchamber + action)
  if (!isRenderTool(part.tool ?? part.name) && input.action !== 'render.page') return null;
  const params = asRecord(input.parameters) ?? {};
  const html = String(params.html ?? input.html ?? '');
  const ui = String(params.ui ?? input.ui ?? '');
  // Une page en langage ui n'est pas du HTML : l'UI du Superviseur ne la dessine
  // pas encore (le texte final de l'agent reste la livraison).
  if (ui.trim() || !html.trim() || html.length > MAX_HTML) return null;
  const meta = asRecord(st.metadata) ?? {};
  const oc = asRecord(meta.openchamber);
  if (oc && oc.ok === false) return null;
  const title = String(params.title ?? input.title ?? '').trim() || titleFromHtml(html);
  return { html, title };
}

/**
 * Extrait la livraison d'une fenêtre de messages. Fonction pure, testée :
 * - le tour courant commence au dernier message humain ;
 * - le texte retenu est le dernier texte assistant du tour (un tour finit
 *   souvent par des tool calls sans texte, donc « dernier message » ne suffit
 *   pas) ;
 * - le rendu retenu est le dernier `openchamber_render` terminé du même tour.
 */
export function parseDelivery(sessionId: string, raw: unknown, now = Date.now()): Delivery {
  const messages = (Array.isArray(raw) ? raw : []) as WireMessage[];
  const sorted = messages
    .filter(m => m && typeof m.type === 'string')
    .slice()
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));

  let lastUser = -1;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].type === 'user') lastUser = i;
  const turn = lastUser >= 0 ? sorted.slice(lastUser + 1) : sorted;

  let markdown = '';
  let textMessage: WireMessage | undefined;
  let render: DeliveryRender | undefined;
  let renderMessage: WireMessage | undefined;

  for (const m of turn) {
    if (m.type !== 'assistant') continue;
    const txt = textOf(m);
    if (txt) {
      markdown = txt;
      textMessage = m;
    }
    for (const part of m.content ?? []) {
      const r = renderOf(part);
      if (r) {
        render = r;
        renderMessage = m;
      }
    }
  }

  const truncated = markdown.length > MAX_MARKDOWN;
  if (truncated) markdown = markdown.slice(0, MAX_MARKDOWN);

  const kept = [textMessage, renderMessage]
    .filter((m): m is WireMessage => !!m)
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  const lastKept = kept[kept.length - 1];
  const lastAssistant = turn.filter(m => m.type === 'assistant').pop();

  return {
    sessionId,
    at: now,
    state: markdown || render ? 'ok' : 'empty',
    messageId: lastKept?.id,
    createdAt: lastKept?.time?.created ?? lastAssistant?.time?.created,
    turnStartedAt: lastUser >= 0 ? sorted[lastUser].time?.created : undefined,
    markdown: markdown || undefined,
    render,
    truncated: truncated || undefined,
  };
}

async function fetchDelivery(sessionId: string): Promise<Delivery> {
  if (!base) {
    return { sessionId, at: Date.now(), state: 'unavailable', error: 'OpenChamber non découvert' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/message?limit=${MESSAGE_LIMIT}`, { signal: ctl.signal });
    if (!res.ok) {
      const error = res.status === 404 ? 'session introuvable' : `OpenChamber ${res.status}`;
      return { sessionId, at: Date.now(), state: 'unavailable', error };
    }
    const body = await res.json() as unknown;
    // certaines versions répondent 200 avec l'erreur dans le corps
    const tag = (body as { _tag?: string })?._tag;
    if (tag === 'SessionNotFoundError') {
      return { sessionId, at: Date.now(), state: 'unavailable', error: 'session introuvable' };
    }
    const messages = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
    return parseDelivery(sessionId, messages ?? []);
  } catch (e) {
    const error = (e as Error)?.name === 'AbortError' ? 'OpenChamber ne répond pas' : String(e);
    return { sessionId, at: Date.now(), state: 'unavailable', error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Livraison d'une session, avec cache court et single-flight. Une réponse vide
 * ou une erreur n'est gardée que 5 s (un tour qui vient de finir ou une
 * instance qui redémarre se rétablit vite).
 */
export async function getDelivery(sessionId: string): Promise<Delivery> {
  const id = String(sessionId ?? '').trim();
  if (!id) return { sessionId: id, at: Date.now(), state: 'unavailable', error: 'sessionId requis' };

  const hit = cache.get(id);
  const ttl = hit?.value.state === 'unavailable'
    ? ERROR_TTL_MS
    : hit?.value.state === 'empty' ? EMPTY_TTL_MS : CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) {
    return hit.value;
  }
  const gen = generationOf(id);
  const running = inFlight.get(id);
  // une requête d'une génération antérieure ne doit pas répondre à un appel
  // postérieur à l'invalidation : on en relance une
  if (running && running.gen === gen) return running.promise;

  const p = fetchDelivery(id)
    .then((value) => {
      // une invalidation pendant la requête : ne pas cacher ce résultat périmé
      if (generationOf(id) === gen) cache.set(id, { value, at: Date.now() });
      return value;
    })
    .finally(() => {
      if (inFlight.get(id)?.gen === gen) inFlight.delete(id);
    });
  inFlight.set(id, { gen, promise: p });
  return p;
}
