/**
 * Le compagnon : une session analyste (agent `superviseur-analyste` global, sans tool)
 * par session supervisée, qui juge l'avancement à intervalles et pousse son verdict JSON.
 * Déclencheurs : fin de tour (idle) + toutes les 5 min si nouveaux messages.
 * Le verdict n'est qu'un SIGNAL : la clôture reste un geste humain (doc 03).
 */
import { logEvent, upsertVerdict, getVerdict, getCompanion, putCompanion } from './state.mts';

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

const PERIOD_MS = Number(process.env.SUPERVISEUR_COMPANION_PERIOD_MS ?? 5 * 60_000);
const MAX_WAIT_MS = 150_000;
const MAX_INJECT_CHARS = 4500;

interface CompanionState {
  compSession?: string;
  inFlight?: boolean;
  lastMsgID?: string;
  lastRunAt?: number;
  lastBrief?: string;
  turnStartSeen?: boolean;
  lastTurnStart?: number;
}
const st = new Map<string, CompanionState>();
const get = (sid: string) => {
  let s = st.get(sid);
  if (!s) st.set(sid, s = {});
  return s;
};

async function jpost(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* pas JSON */ }
  return { status: res.status, ok: res.ok, data };
}

async function jget(path: string) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** fetch les messages, ordonnés chronologiquement ; détecte l'objectif (1er message humain) */
async function digestNew(sid: string, s: CompanionState, force = false) {
  type M = { id: string; type: string; time?: { created?: number }; content?: Array<{ type: string; text?: string }>; payload?: { text?: string } };
  const out = await jget(`/api/session/${sid}/message?limit=30`) as { data?: M[] };
  const conv = (out.data ?? [])
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));   // ancien → récent, peu importe l'ordre de l'API
  if (!conv.length) return null;
  // objectif : le plus ancien message humain disponible (limit=30 : parfois pas le tout premier)
  const goal = (conv.find(m => m.type === 'user')?.payload?.text ?? '').slice(0, 400);
  // du frais : messages apparus depuis la dernière analyse ; premier passage ou force = les 4 derniers
  const idx = s.lastMsgID ? conv.findIndex(m => m.id === s.lastMsgID) : -1;
  let fresh = idx >= 0 ? conv.slice(idx + 1) : conv.slice(-4);
  if (force && !fresh.length) fresh = conv.slice(-4);
  fresh = fresh.slice(-6);
  s.lastMsgID = conv[conv.length - 1]?.id ?? s.lastMsgID;
  if (!fresh.length) return null;

  const parts: string[] = [];
  for (let i = 0; i < fresh.length; i++) {
    const m = fresh[i];
    let txt = (m.type === 'user' ? m.payload?.text : m.content?.filter(c => c.type === 'text').map(c => c.text).join(' ')) ?? '';
    let tag = (i === fresh.length - 1 && m.type === 'assistant')
      ? 'AGENT (DERNIER MESSAGE — état le plus récent du travail)'
      : (m.type === 'user' ? 'HUMAIN' : 'AGENT');
    if (!txt && m.type === 'assistant') {
      // tour en cours : souvent des tool calls sans texte — le raisonnement révèle l'activité
      const reasoning = m.content?.filter(c => c.type === 'reasoning').map(c => c.text).join(' ') ?? '';
      if (reasoning) { txt = reasoning.slice(0, 500); tag = 'AGENT (raisonnement en cours — tour pas fini)'; }
    }
    if (!txt) continue;
    parts.push(`[${tag}] ${txt}`.slice(0, 950));
  }
  return parts.join('\n') + `\n(Objectif de la tâche : ${goal || 'inconnu de l\u2019extrait'})`;
}

function persistedCompanion(sid: string): string | null { return getCompanion(sid); }
function rememberCompanion(sid: string, compId: string) { putCompanion(sid, compId); }

async function ensureCompanion(sid: string, s: CompanionState) {
  if (s.compSession) return s.compSession;
  const known = persistedCompanion(sid);
  if (known) { s.compSession = known; return known; }
  const r = await jpost('/api/session', { parentID: sid, title: 'comp. supervision' });
  const id = (r.data as { data?: { id?: string } })?.data?.id;
  if (!id) throw new Error('session compagnon non créée');
  s.compSession = id;
  rememberCompanion(sid, id);
  logEvent(sid, 'note', `compagnon #${id.slice(-6)}`);
  return id;
}

async function waitReply(compId: string, sinceMs: number): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let lastText = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const stt = await jget(`/api/session/${compId}/message?limit=6`) as { data?: Array<{ type: string; time?: { created?: number }; completed?: number; content?: Array<{ type: string; text?: string }> }> };
      // UNIQUEMENT les réponses postérieures à notre injection (sinon on rattrape la précédente)
      const replies = (stt.data ?? []).filter(m => m.type === 'assistant' && (m.time?.created ?? 0) >= sinceMs);
      const last = replies[replies.length - 1];
      const text = last?.content?.filter(c => c.type === 'text').map(c => c.text).join(' ') ?? '';
      if (text) {
        lastText = text;
        // dès que le texte parse en verdict, on s'arrête — le marqueur "complété" arrive en retard
        if (parseVerdict(text)) return text;
      }
    } catch { /* réseau : on retente */ }
  }
  return lastText;
}

function scrubFrench(t: string): string {
  // pansement jusqu'à ce que le modèle de l'agent apprenne le tutoiement (voir AGENTS.md companión)
  return t
    .replace(/l'humain fournit-il d'autres idées/gi, 'As-tu d\u2019autres idées')
    .replace(/l'humain fournit-il/gi, 'As-tu')
    .replace(/\bl'humain\b/gi, 'tu')
    .replace(/Arbitrage utilisateur attendu/gi, 'À toi de trancher');
}

function parseVerdict(text: string): { resume?: string; termine?: boolean; confiance?: number; progress?: number; attend?: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as Record<string, unknown>;
    // clés tolérantes (le modèle glisse parfois des accents : "résumé", "progrès"…)
    const pick = (...ks: string[]) => { for (const k of ks) if (v[k] != null) return v[k]; return undefined; };
    const resume = pick('summary', 'resume', 'résumé');
    const termine = pick('done', 'termine', 'terminé', 'fini');
    const confiance = pick('confidence', 'confiance');
    const progress = pick('progress', 'progrès', 'avancement');
    const attend = pick('pending_human', 'attend', 'attente');
    const note = pick('confidence_reason', 'confidence_note', 'confiance_reason', 'pourquoi');
    if (typeof resume !== 'string') return null;
    return {
      resume: scrubFrench(String(resume)).slice(0, 300),
      termine: !!termine,
      confiance: Math.max(0, Math.min(1, Number(confiance) || 0)),
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      attend: scrubFrench(typeof attend === 'string' ? attend : '').slice(0, 160),
      note: typeof note === 'string' ? scrubFrench(note).slice(0, 160) : '',
    };
  } catch { return null; }
}

async function analyseOnce(sid: string, title: string, dir?: string, status?: string, force = false) {
  const s = get(sid);
  if (s.inFlight) return;
  try {
    const digest = await digestNew(sid, s, force);
    if (!digest) { s.lastRunAt = Date.now(); return; }
    s.inFlight = true;
    const compId = await ensureCompanion(sid, s);
    const inject = [
      `Tâche : ${title}`,
      `Session actuellement : ${status ?? 'idle'}`,
      s.lastBrief ? `Ton résumé précédent (rappěl des faits; reformule-le toujours en tutoyant directement l'utilisateur, sans le mot « humain ») : ${s.lastBrief}` : '',
      `Message(s) récent(s) :`,
      digest,
      `Rappel: tes textes s'affichent directement à l'utilisateur, en « tu » : « As-tu… », « À toi de… ». Jamais le mot « humain » dans summary/pending_human. Ton JSON doit inclure TOUTES les clés, surtout confidence_reason.`,
    ].filter(Boolean).join('\n\n').slice(0, MAX_INJECT_CHARS);
    const p = await jpost(`/api/openchamber/sessions/${compId}/send`, { prompt: inject, agent: 'superviseur-analyste', directory: dir });
    if (!p.ok) throw new Error(`prompt compagnon → ${p.status}`);
    const reply = await waitReply(compId, Date.now() - 1500);
    const v = parseVerdict(reply);
    if (v) {
      s.lastBrief = v.resume;
      upsertVerdict(sid, v);
      logEvent(sid, 'note', `analyste: ${v.resume}`, { confiance: v.confiance, progress: v.progress, termine: v.termine });
    } else {
      logEvent(sid, 'note', 'analyste: réponse illisible (gardé l\u2019ancien)');
    }
  } catch (e) {
    logEvent(sid, 'note', `analyste: échec ${String(e).slice(0, 80)}`);
  } finally {
    s.inFlight = false;
    s.lastRunAt = Date.now();
  }
}

/** appelé à chaque tick de flotte : idle → analyse tout de suite ; busy → analyse périodique */
export function companionTick(sessions: OpenchamberSession[], statusMap: Record<string, { status: string }>): void {
  if (process.env.SUPERVISEUR_COMPANION === 'off') return;
  for (const sess of sessions) {
    if (sess.parentID) continue;                      // pas pour les sous-sessions
    const stt = statusMap[sess.id];
    if (!stt) continue;
    const s = get(sess.id);
    // nouveau tour détecté (l'utilisateur a envoyé un prompt) : analyse immédiate du cadrage
    const turnStart = statusMap[sess.id] ? (stt as { turnStartedAt?: number }).turnStartedAt : undefined;
    const newTurn = turnStart != null && s.lastTurnStart !== turnStart
      && stt.status === 'busy'
      && (s.lastRunAt ?? 0) < Date.now() - 15_000;
    if (turnStart != null) s.lastTurnStart = turnStart;
    const verdict = verdictOf(sess.id) as { note?: string; resume?: string; attend?: string } | null;
    const staleVoice = !!verdict
      && ((verdict.resume ?? '') + (verdict.attend ?? '')).toLowerCase().includes('humain');
    const needsNote = !!verdict && !verdict.note;
    const due = newTurn
      || stt.status === 'idle'
      || (stt.status === 'busy' && (s.lastRunAt ?? 0) < Date.now() - PERIOD_MS)
      || ((needsNote || staleVoice) && (s.lastRunAt ?? 0) < Date.now() - 60_000);
    if (s.inFlight || !due) continue;
    void analyseOnce(sess.id, sess.title ?? sess.id.slice(0, 12), sess.location?.directory, stt.status, newTurn || needsNote || staleVoice);
  }
}

export function verdictOf(sid: string) { return getVerdict(sid); }
export function companionSessionOf(sid: string) { return get(sid).compSession ?? null; }
