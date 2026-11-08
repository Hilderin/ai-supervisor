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
import { getTaskBrief, getVerifier } from './state.mts';
import { toolActionLine } from './verdict.mts';
import { messageText } from './messages.mts';
import { readProjectFile } from './investigation.mts';
import type { ToolResult } from './tools.mts';

const MAX_MESSAGES = 60;
const MAX_TOOLS = 40;
const MAX_SEARCH = 30;
const MAX_TEXT_CHARS = 600;
const MAX_QUERY_CHARS = 500;
const PAGE = 200;
const MAX_TOOL_DETAIL = 2000;
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
 * dédupliquées par id et triées par temps ; l'API ignore offset/curseurs.
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

function toolParts(m: WireMessage): WirePart[] {
  return (m.content ?? []).filter(p => p.type === 'tool');
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
      for (const part of toolParts(m)) {
        const line = toolActionLine(part);
        calls.push({
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

function summarizeState(state: WirePart['state']): Record<string, unknown> {
  const input = state?.input ?? {};
  const trimmedInput: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
    trimmedInput[k] = typeof v === 'string' ? v.slice(0, MAX_TOOL_DETAIL) : (s.length > MAX_TOOL_DETAIL ? `${s.slice(0, MAX_TOOL_DETAIL)}...` : v);
  }
  let output = state?.output;
  if (output == null && state?.metadata != null) output = state.metadata;
  if (typeof output === 'object' && output != null) {
    output = JSON.stringify(output);
  }
  const outputText = String(output ?? '');
  return {
    input: trimmedInput,
    output: outputText.slice(0, MAX_TOOL_DETAIL),
    outputTruncated: outputText.length > MAX_TOOL_DETAIL || undefined,
    status: state?.status ?? '',
  };
}

/**
 * Un tool call précis avec son entrée et sa sortie complètes. Sélection :
 * `{index}` (position dans la liste récente du plus récent au plus ancien) ou
 * `{tool}` + `{query?}` (premier call du nom donné dont l'entrée contient la
 * requête). C'est ce qui permet de vérifier une preuve « sortie de test »
 * plutôt que sa simple description.
 */
export async function verifierToolResult(parentId: string, args: { tool?: unknown; query?: unknown; index?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const tool = String(args.tool ?? '').trim();
  const query = String(args.query ?? '').trim();
  const index = Math.floor(Number(args.index));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  if (!tool && !Number.isFinite(index) && !query) {
    return { ok: false, error: 'invalid', message: 'donne index, ou tool (et query optionnelle)' };
  }
  try {
    const history = await fetchHistory(parentId, since);
    const calls: Array<{ m: WireMessage; part: WirePart }> = [];
    for (const m of [...history].reverse()) {
      for (const part of toolParts(m)) {
        calls.push({ m, part });
      }
    }
    let picked: { m: WireMessage; part: WirePart } | undefined;
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
    const line = toolActionLine(picked.part);
    return {
      ok: true,
      toolCall: {
        at: picked.m.time?.created ?? 0,
        messageId: picked.m.id ?? '',
        name: String(picked.part.name ?? picked.part.tool ?? ''),
        ...summarizeState(picked.part.state),
        detail: line ? line.replace(/^\[OUTIL [^\]]+\] /, '') : '',
      },
      count: calls.length,
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
    try {
      // le dossier de session du parent n'est PAS forcément le projet : pour une
      // image, on lit via le même garde de chemin relatif qu'une lecture de projet
      const read = await readProjectFile(dir, path);
      if (!read.ok && read.error !== 'fichier_binaire_refuse') return { ok: false, error: read.error, message: read.error ?? 'lecture refusee' };
      return { ok: false, error: 'artifact_image', message: `« ${path} » est une image : ce tool n'en donne pas le rendu visuel ; demande une preuve textuelle complémentaire (sortie de test, texte) si le visuel porte le critère` };
    } catch (e) {
      return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
    }
  }
  return await readProjectFile(dir, path, Number(args.start_line) || undefined, Number(args.line_count) || undefined) as unknown as ToolResult;
}

/* --- verifier_search : sur tout l'historique couvert, messages et tool calls --- */

export async function verifierSearch(parentId: string, args: { query?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) return { ok: false, error: 'texte_requis', message: 'query requis' };
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: 'requete_trop_longue', message: `query limité à ${MAX_QUERY_CHARS} caractères` };
  }
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const history = await fetchHistory(parentId, since);
    const needle = query.toLowerCase();
    const matches: Array<Record<string, unknown>> = [];
    for (const m of history) {
      const text = messageText(m);
      if (text) {
        const lower = text.toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx >= 0) {
          matches.push({
            id: m.id ?? '',
            type: m.type ?? '?',
            at: m.time?.created ?? 0,
            field: 'message',
            excerpt: text.slice(Math.max(0, idx - 120), idx + query.length + 240).slice(0, 400),
          });
        }
      }
      for (const part of toolParts(m)) {
        const inputText = JSON.stringify(part.state?.input ?? {}).toLowerCase();
        const idx = inputText.indexOf(needle);
        if (idx >= 0) {
          matches.push({
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
    return { ok: true, matches, count: matches.length, historyCovered: history.length };
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
