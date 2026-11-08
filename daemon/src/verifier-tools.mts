/**
 * Lectures bornées de la conversation de l'agent principal, pour le
 * vérificateur (plugin superviseur-verifier → POST /api/verifier/:name).
 *
 * Le daemon vérifie que l'appelant est bien le vérificateur de la tâche
 * (verifier_map) et n'interroge OpenChamber que pour la session parent. Trois
 * outils de lecture, rien d'autre : liste des messages, tool calls récents,
 * recherche dans la conversation.
 */
import { currentFleet, openchamberUrl } from './fleet.mts';
import { getVerifier } from './state.mts';
import { toolActionLine } from './verdict.mts';
import type { ToolResult } from './tools.mts';

const MAX_MESSAGES = 60;
const MAX_TOOLS = 40;
const MAX_SEARCH = 30;
const MAX_TEXT_CHARS = 600;
const MAX_QUERY_CHARS = 500;

interface WirePart {
  type?: string;
  name?: string;
  tool?: string;
  text?: string;
  state?: { status?: string; input?: Record<string, unknown> };
}
interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  content?: WirePart[];
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

function messageText(m: WireMessage): string {
  const direct = typeof m.content === 'string' ? m.content : '';
  if (direct) return direct;
  return (m.content ?? [])
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join(' ')
    .trim();
}

function sortDesc(messages: WireMessage[]): WireMessage[] {
  return [...messages].sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
}

async function fetchParentMessages(parentId: string, limit: number, since?: number): Promise<WireMessage[]> {
  const body = await jget(`/api/session/${parentId}/message?limit=200&order=desc`) as { data?: WireMessage[] };
  let list = sortDesc(body.data ?? []);
  if (since) list = list.filter(m => (m.time?.created ?? 0) >= since);
  return list.slice(0, limit);
}

export async function verifierMessages(parentId: string, args: { limit?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const limit = Math.min(MAX_MESSAGES, Math.max(1, Math.floor(Number(args.limit) || 30)));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const messages = await fetchParentMessages(parentId, limit, since);
    const out = messages.map(m => {
      const text = messageText(m);
      const toolCalls = (m.content ?? []).filter(p => p.type === 'tool').length;
      return {
        id: m.id ?? '',
        type: m.type ?? '?',
        at: m.time?.created ?? 0,
        text: text.slice(0, MAX_TEXT_CHARS),
        toolCalls: toolCalls || undefined,
      };
    });
    return { ok: true, messages: out, count: out.length };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

export async function verifierTools(parentId: string, args: { limit?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const limit = Math.min(MAX_TOOLS, Math.max(1, Math.floor(Number(args.limit) || 20)));
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const messages = await fetchParentMessages(parentId, 200, since);
    const calls: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      for (const part of m.content ?? []) {
        if (part.type !== 'tool') continue;
        const line = toolActionLine(part);
        calls.push({
          at: m.time?.created ?? 0,
          name: String(part.name ?? part.tool ?? ''),
          status: part.state?.status ?? '',
          detail: line ? line.replace(/^\[OUTIL [^\]]+\] /, '') : '',
        });
        if (calls.length >= limit) break;
      }
      if (calls.length >= limit) break;
    }
    return { ok: true, toolCalls: calls, count: calls.length };
  } catch (e) {
    return { ok: false, error: 'inspect_failed', message: String((e as Error)?.message ?? e) };
  }
}

export async function verifierSearch(parentId: string, args: { query?: unknown; since?: unknown } = {}): Promise<ToolResult> {
  const query = String(args.query ?? '').trim();
  if (!query) return { ok: false, error: 'texte_requis', message: 'query requis' };
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: 'requete_trop_longue', message: `query limité à ${MAX_QUERY_CHARS} caractères` };
  }
  const since = Number(args.since) > 0 ? Number(args.since) : undefined;
  try {
    const messages = await fetchParentMessages(parentId, MAX_MESSAGES, since);
    const needle = query.toLowerCase();
    const matches: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      const text = messageText(m);
      if (!text) continue;
      const lower = text.toLowerCase();
      const idx = lower.indexOf(needle);
      if (idx < 0) continue;
      matches.push({
        id: m.id ?? '',
        type: m.type ?? '?',
        at: m.time?.created ?? 0,
        excerpt: text.slice(Math.max(0, idx - 120), idx + query.length + 240).slice(0, 400),
      });
      if (matches.length >= MAX_SEARCH) break;
    }
    return { ok: true, matches, count: matches.length };
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
  if (name === 'verifier_search') return verifierSearch(parentId, args);
  return { ok: false, error: 'unknown_tool', message: name };
}
