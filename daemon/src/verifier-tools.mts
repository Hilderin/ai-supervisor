/**
 * Lectures bornées de la conversation de l'agent principal, pour le
 * vérificateur (plugin superviseur-verifier → POST /api/verifier/:name).
 *
 * Le daemon vérifie que l'appelant est bien le vérificateur de la tâche
 * (verifier_map) et n'interroge OpenChamber que pour la session parent. Cinq
 * outils de lecture, rien d'autre : messages, tool calls récents, artefact de
 * preuve, entrée/sortie d'un tool call précis, recherche.
 *
 * Piège du listing (leçon AGENTS.md) : le texte du prompt humain est à la
 * racine du message (`m.text`), jamais seulement dans `content` ; lecture par
 * le helper central `messageText` (messages.mts). Le listing ne supporte NI
 * offset NI curseur (vérifié sur l'instance : offset/after/until ignorés) et
 * la recherche serveur est désactivée : la « pagination » est l'union des deux
 * extrémités (asc 200 + desc 200, dédupliqués).
 */
import { currentFleet, openchamberUrl } from './fleet.mts';
import { getTaskBrief, getVerifier, indexedCount, searchIndexedMessages } from './state.mts';
import { toolActionLine } from './verdict.mts';
import { messageText } from './messages.mts';
import { readProjectFile, resolveProjectImage } from './investigation.mts';
import type { ToolResult } from './tools.mts';

const MAX_MESSAGES = 60;
const MAX_TOOLS = 40;
const MAX_SEARCH = 30;
const MAX_TEXT_CHARS = 600;
const MAX_QUERY_CHARS = 500;
const PAGE = 200;
const MAX_TOOL_DETAIL = 2000;   // page PAR DÉFAUT de sortie ; la sortie se lit par plages (offset/length), pas de plafond global
const MAX_OUTPUT_PAGE = 10000;  // page maximale d'un seul appel
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

interface WirePart {
  type?: string;
  name?: string;
  tool?: string;
  text?: string;
  state?: { status?: string; input?: Record<string, unknown>; output?: unknown; metadata?: Record<string, unknown> };
}
interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  text?: string;
  content?: WirePart[];
  payload?: { text?: string };
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

/** Le vérificateur ne peut inspecter que le parent auquel il est mappé. */
export function verifierParentTask(callerSessionId: string): string | null {
  if (!callerSessionId) return null;
  for (const row of currentFleet().rows) {
    if (getVerifier(row.id)?.verifierId === callerSessionId) return row.id;
  }
  return null;
}

function sortAsc(messages: WireMessage[]): WireMessage[] {
  return [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
}

/**
 * Historique couvert : les deux extrémités du listing (asc 200 + desc 200),
 * dédupliquées par id et triées par temps ; l'API ignore offset/curseurs et
 * refuse tout limit > 200 (renvoie 0, vérifié sur l'instance).
 */
async function fetchHistory(parentId: string, since?: number): Promise<WireMessage[]> {
  const byId = new Map<string, WireMessage>();
  for (const order of ['asc', 'desc']) {
    try {
      const body = await jget(`/api/session/${parentId}/message?limit=${PAGE}&order=${order}`) as { data?: WireMessage[] };
      for (const m of body.data ?? []) {
        if (m?.id) byId.set(m.id, m);
      }
    } catch { /* une extrémité manquante : garder l'autre */ }
  }
  let list = sortAsc([...byId.values()]);
  if (since) list = list.filter(m => (m.time?.created ?? 0) >= since);
  return list;
}

function toolParts(m: WireMessage): Array<{ part: WirePart; partIndex: number }> {
  return (m.content ?? []).map((part, partIndex) => ({ part, partIndex })).filter(p => p.part.type === 'tool');
}

/** Identifiant STABLE d'un tool call : le couple messageId:partIndex (les ids de messages ne bougent pas). */
export function toolCallId(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

/* --- verifier_messages --- */

export async function verifierMessages(parentId: string, args: { limit?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const limit = Math.min(MAX_MESSAGES, Math.max(1, Math.floor(Number(args.limit) || 30)));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const history = await fetchHistory(parentId, since);
    const out = history.slice(-limit).map(m => {
      const text = messageText(m);
      const toolCalls = toolParts(m).length;
      return {
        id: m.id ?? '',
        type: m.type ?? '?',
        at: m.time?.created ?? 0,
        text: text.slice(0, MAX_TEXT_CHARS),
        toolCalls: toolCalls || undefined,
      };
    });
    return { ok: true, messages: out, count: out.length, historyCovered: history.length };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

/* --- verifier_tools --- */

export async function verifierTools(parentId: string, args: { limit?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const limit = Math.min(MAX_TOOLS, Math.max(1, Math.floor(Number(args.limit) || 20)));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const history = await fetchHistory(parentId, since);
    const calls: Array<Record<string, unknown>> = [];
    for (const m of [...history].reverse()) {   // du plus récent au plus ancien
      for (const { part, partIndex } of toolParts(m)) {
        const line = toolActionLine(part);
        calls.push({
          callId: toolCallId(m.id ?? '', partIndex),   // identifiant stable, à repasser à verifier_tool_result
          at: m.time?.created ?? 0,
          messageId: m.id ?? '',
          name: String(part.name ?? part.tool ?? ''),
          status: part.state?.status ?? '',
          detail: line ? line.replace(/^\[OUTIL [^\]]+\] /, '') : '',
        });
        if (calls.length >= limit) break;
      }
      if (calls.length >= limit) break;
    }
    return { ok: true, toolCalls: calls, count: calls.length, historyCovered: history.length };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

/* --- verifier_tool_result : entrée et sortie complètes d'un tool call précis --- */

/**
 * Sortie lue PAR PAGES : `offset` (0 par défaut) et `length` (page par défaut
 * MAX_TOOL_DETAIL, max MAX_OUTPUT_PAGE) : un test dont le résumé est en fin de
 * sortie volumineuse se lit en pages successives, pas de plafond fixe. La
 * réponse porte `total` et `nextOffset` pour chaîner les pages.
 */
function outputPage(state: WirePart['state'], offset: number, length: number) {
  let output: unknown = state?.output;
  if (output == null && state?.metadata != null) output = state.metadata;
  if (typeof output === 'object' && output != null) output = JSON.stringify(output);
  const full = String(output ?? '');
  const slice = full.slice(offset, offset + length);
  const nextOffset = offset + slice.length;
  return {
    output: slice,
    total: full.length,
    offset,
    truncated: nextOffset < full.length,
    nextOffset: nextOffset < full.length ? nextOffset : undefined,
  };
}

function summarizeInput(state: WirePart['state']): Record<string, unknown> {
  const input = state?.input ?? {};
  const trimmedInput: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
    trimmedInput[k] = typeof v === 'string' ? v.slice(0, MAX_TOOL_DETAIL) : (s.length > MAX_TOOL_DETAIL ? `${s.slice(0, MAX_TOOL_DETAIL)}...` : v);
  }
  return trimmedInput;
}

/**
 * Un tool call précis avec son entrée et sa sortie complètes (par plages).
 * Sélection : `{callId}` (identifiant STABLE `messageId:partIndex` renvoyé par
 * verifier_tools, à privilégier), ou `{index}` (position dans la liste récente
 * du plus récent au plus ancien) ou `{tool}` + `{query?}`. Lecture de la
 * sortie : `{offset?, length?}` pour pager au-delà de la première page.
 */
export async function verifierToolResult(parentId: string, args: { callId?: unknown; tool?: unknown; query?: unknown; index?: unknown; offset?: unknown; length?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const callId = String(args.callId ?? '').trim();
  const tool = String(args.tool ?? '').trim();
  const query = String(args.query ?? '').trim();
  const index = Math.floor(Number(args.index));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const length = Math.min(MAX_OUTPUT_PAGE, Math.max(1, Math.floor(Number(args.length) || MAX_TOOL_DETAIL)));
  if (!callId && !tool && !Number.isFinite(index) && !query) {
    return { ok: false, error: 'invalid', message: 'donne callId (stable), ou index, ou tool (et query optionnelle)' };
  }
  try {
    const history = await fetchHistory(parentId, since);
    const byId = new Map(history.map(m => [m.id ?? '', m]));
    let picked: { m: WireMessage; part: WirePart; callId: string } | undefined;
    if (callId) {
      const sep = callId.lastIndexOf(':');
      const msgId = sep > 0 ? callId.slice(0, sep) : '';
      const partIndex = sep > 0 ? Number(callId.slice(sep + 1)) : NaN;
      const m = byId.get(msgId);
      const part = m && Number.isInteger(partIndex) ? (m.content ?? [])[partIndex] : undefined;
      if (!m || !part || part.type !== 'tool') {
        return { ok: false, error: 'callId_inconnu', message: `callId « ${callId} » introuvable dans l'historique couvert (le message a pu sortir des deux extrémités)`, count: history.length };
      }
      picked = { m, part, callId };
    } else {
      const calls: Array<{ m: WireMessage; part: WirePart; callId: string }> = [];
      for (const m of [...history].reverse()) {
        for (const { part, partIndex } of toolParts(m)) {
          calls.push({ m, part, callId: toolCallId(m.id ?? '', partIndex) });
        }
      }
      if (Number.isFinite(index) && index >= 0) {
        picked = calls[index];
        if (!picked) return { ok: false, error: 'index_out_of_range', message: `index ${index} hors de ${calls.length} tool calls`, count: calls.length };
      } else {
        const needle = query.toLowerCase();
        picked = calls.find(({ part }) => {
          if (tool && String(part.name ?? part.tool ?? '') !== tool) return false;
          if (!query) return true;
          const inputText = JSON.stringify(part.state?.input ?? {}).toLowerCase();
          return inputText.includes(needle);
        });
        if (!picked) {
          return { ok: false, error: 'not_found', message: `aucun tool call${tool ? ` « ${tool} »` : ''}${query ? ` contenant « ${query} »` : ''}`, count: calls.length };
        }
      }
    }
    const line = toolActionLine(picked.part);
    return {
      ok: true,
      toolCall: {
        callId: picked.callId,
        at: picked.m.time?.created ?? 0,
        messageId: picked.m.id ?? '',
        name: String(picked.part.name ?? picked.part.tool ?? ''),
        input: summarizeInput(picked.part.state),
        status: picked.part.state?.status ?? '',
        ...outputPage(picked.part.state, offset, length),
        detail: line ? line.replace(/^\[OUTIL [^\]]+\] /, '') : '',
      },
      count: history.length,
    };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

/* --- verifier_artifact : artefact de preuve, borné au projet du parent --- */

/**
 * Lit un artefact référencé par une preuve : extrait de code ou texte (avec
 * `start_line`/`line_count`), image (descripteur : existence, type, taille ;
 * l'inspection VISUELLE n'est pas disponible via ce tool : le vérificateur
 * exige alors une preuve textuelle complémentaire si le visuel porte le
 * critère). Le chemin est borné au dossier du projet du parent, même règles
 * que les lectures d'investigation (relatif, sans sortie, sans lien symbolique).
 */
export async function verifierArtifact(parentId: string, args: { path?: unknown; start_line?: unknown; line_count?: unknown } = {}): Promise<ToolResult> {
  const path = String(args.path ?? '').trim();
  if (!path) return { ok: false, error: 'invalid', message: 'path requis (relatif au projet du parent)' };
  const dir = getTaskBrief(parentId)?.project_dir ?? currentFleet().rows.find(r => r.id === parentId)?.dir;
  if (!dir) return { ok: false, error: 'project_unknown', message: 'dossier du projet du parent inconnu' };
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ext in IMAGE_MIME;
  if (isImage) {
    // Une image de preuve est TRANSMISE à la session vérificateur (retour du
    // propriétaire, 2026-11-08 : « le vérificateur devrait voir l'image
    // lui-même », pas une description générée par l'agent) : mêmes gardes de
    // chemin que les lectures d'investigation, et le plugin attache le
    // fichier réel (Tool.FileContent) au résultat du tool.
    const img = await resolveProjectImage(dir, path, IMAGE_MIME);
    if (!img.ok) return { ok: false, error: img.error, message: img.error ?? 'lecture refusee' };
    return {
      ok: true,
      image: { path: img.abs, mime: img.mime, size: img.size, name: path.split('/').pop() },
      message: 'image validée et transmise : tu la VOIS ci-dessus ; juge le rendu visuel directement, sans la description de l agent',
    };
  }
  return await readProjectFile(dir, path, Number(args.start_line) || undefined, Number(args.line_count) || undefined) as unknown as ToolResult;
}

/* --- verifier_search : index local (pleine couverture) puis listing en filet --- */

export async function verifierSearch(parentId: string, args: { query?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) return { ok: false, error: 'texte_requis', message: 'query requis' };
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: 'requete_trop_longue', message: `query limité à ${MAX_QUERY_CHARS} caractères` };
  }
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const needle = query.toLowerCase();
    const matches: Array<Record<string, unknown>> = [];
    const push = (m: Record<string, unknown>) => {
      if (matches.length < MAX_SEARCH) matches.push(m);
    };

    // 1) INDEX LOCAL : alimenté progressivement par le daemon (fenêtre
    // glissante à chaque événement message.*, upsert dédupliqué) : il couvre
    // tout ce qui a coulé pendant la vie du daemon, y compris les messages
    // centraux que le listing ne remonte plus (l'API ignore offset/curseurs
    // et refuse limit > 200). Coverage rapportée honnêtement.
    const indexed = searchIndexedMessages(parentId, query, MAX_SEARCH) || [];
    const seen = new Set<string>();
    for (const row of indexed) {
      if (since && row.at < since) continue;
      const text = row.text ?? '';
      const idx = text.toLowerCase().indexOf(needle);
      if (idx >= 0) {
        seen.add(`${row.msg_id}:message`);
        push({ id: row.msg_id, type: row.type, at: row.at, field: 'message', excerpt: text.slice(Math.max(0, idx - 120), idx + query.length + 240).slice(0, 400) });
      }
      const tools = row.tool_calls ?? '';
      const tIdx = tools.toLowerCase().indexOf(needle);
      if (tIdx >= 0) {
        seen.add(`${row.msg_id}:tool_input`);
        push({ id: row.msg_id, type: 'tool_call', at: row.at, field: 'tool_input', excerpt: tools.slice(Math.max(0, tIdx - 100), tIdx + query.length + 200).slice(0, 400) });
      }
    }

    // 2) FILET : listing live (les messages pas encore indexés)
    const history = await fetchHistory(parentId, since);
    for (const m of history) {
      const text = messageText(m);
      if (text) {
        const lower = text.toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx >= 0 && !seen.has(`${m.id}:message`)) {
          push({
            id: m.id ?? '',
            type: m.type ?? '?',
            at: m.time?.created ?? 0,
            field: 'message',
            excerpt: text.slice(Math.max(0, idx - 120), idx + query.length + 240).slice(0, 400),
          });
        }
      }
      for (const { part } of toolParts(m)) {
        const inputText = JSON.stringify(part.state?.input ?? {}).toLowerCase();
        const idx = inputText.indexOf(needle);
        if (idx >= 0 && !seen.has(`${m.id}:tool_input`)) {
          push({
            id: m.id ?? '',
            type: 'tool_call',
            at: m.time?.created ?? 0,
            field: 'tool_input',
            tool: String(part.name ?? part.tool ?? ''),
            excerpt: inputText.slice(Math.max(0, idx - 100), idx + query.length + 200).slice(0, 400),
          });
        }
      }
      if (matches.length >= MAX_SEARCH) break;
    }
    return { ok: true, matches, count: matches.length, historyCovered: history.length, indexed: indexedCount(parentId) };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

/** Dispatch unique pour la route /api/verifier/:name. */
export async function runVerifierTool(name: string, callerSessionId: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (process.env.SUPERVISEUR_VERIFIER === 'off') {
    return { ok: false, error: 'disabled', message: 'le vérificateur est désactivé' };
  }
  const parentId = verifierParentTask(callerSessionId);
  if (!parentId) {
    return { ok: false, error: 'not_verifier', message: 'outil réservé au vérificateur d’une tâche' };
  }
  if (name === 'verifier_messages') return verifierMessages(parentId, args);
  if (name === 'verifier_tools') return verifierTools(parentId, args);
  if (name === 'verifier_tool_result') return verifierToolResult(parentId, args);
  if (name === 'verifier_artifact') return verifierArtifact(parentId, args);
  if (name === 'verifier_search') return verifierSearch(parentId, args);
  return { ok: false, error: 'unknown_tool', message: name };
}
