/**
 * Le compagnon : une session analyste (agent `superviseur-analyste` global, sans tool)
 * par session supervisée, qui juge l'avancement à intervalles et pousse son verdict JSON.
 * Déclencheurs : fin de tour (idle) + toutes les 5 min si nouveaux messages.
 * Le verdict n'est qu'un SIGNAL : la clôture reste un geste humain (doc 03).
 */
import { logEvent, upsertVerdict, getVerdict, getCompanion, putCompanion } from './state.mts';
import { takeKick } from './kicks.mts';
import { getAgentVersion } from './state.mts';

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
  if (!parts.length) {
    // digest télescopé : pas un « extrait vide », mais le début d'un tour — dire ce qu'on attend du modèle
    parts.push('(aucun texte nouveau pour l\u2019instant : le tour vient de démarrer. Ne décrit PAS l\u2019état de l\u2019extrait : résume l\u2019objectif de la tâche et la demande en cours, en tutoyant l\u2019utilisateur.)');
  }
  return parts.join('\n') + `\n(Objectif de la tâche : ${goal || 'inconnu de l\u2019extrait'})`;
}

function persistedCompanion(sid: string): string | null { return getCompanion(sid); }
function rememberCompanion(sid: string, compId: string) { putCompanion(sid, compId); }

async function ensureCompanion(sid: string, s: CompanionState) {
  if (s.compSession) return s.compSession;
  const known = persistedCompanion(sid);
  const currentV = getAgentVersion();
  // version du prompt changée ? → on relâche l'ancien compagnon et on en crée un neuf (prompt à jour)
  if (known && (known.version === null || known.version !== currentV)) {
    try {
      await jpost('/api/openchamber/sessions/archive', { ids: [known.compId] });
      logEvent(sid, 'note', 'compagnon déclassé (prompt de l\u2019analyste a changé)');
    } catch { /* garde le jeton */ }
    s.compSession = undefined;
  } else if (known) {
    s.compSession = known.compId;
    return known.compId;
  }
  const r = await jpost('/api/session', { parentID: sid, title: 'comp. supervision' });
  const id = (r.data as { data?: { id?: string } })?.data?.id;
  if (!id) throw new Error('session compagnon non créée');
  s.compSession = id;
  rememberCompanion(sid, id);
  logEvent(sid, 'note', `compagnon #${id.slice(-6)} (v agent ${currentV ? 'à jour' : '?'})`);
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
    let digest = await digestNew(sid, s, force);
    // au kick start (tour qui vient de démarrer), le message peut ne pas être persisté/lu tout de suite :
    // ré-essayer le digest jusqu'à voir du texte réel (le prompt de l'utilisateur), max ~4 s
    if (force) {
      for (let i = 0; i < 5 && digest && !digest.includes('[HUMAIN]') && !digest.includes('[AGENT'); i++) {
        await new Promise(r => setTimeout(r, 900));
        digest = await digestNew(sid, s, true);
      }
    }
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
    // kicks par événements (cablés: inbox.enqueued → start ; execution.succeeded/failed/interrupted → end)
    // NOTE : PAS de déclenchement par turnStartedAt — il varie à chaque sous-exécution (faux « nouveau tour »)
    const kick = takeKick(sess.id);
    const verdict = verdictOf(sess.id) as { note?: string; resume?: string; attend?: string } | null;
    const staleVoice = !!verdict
      && ((verdict.resume ?? '') + (verdict.attend ?? '')).toLowerCase().includes('humain');
    const needsNote = !!verdict && !verdict.note;
    // PAS de déclenchement à vide : un tick sur une session idle immobile ne fait RIEN.
    const busyPeriodic = stt.status === 'busy' && (s.lastRunAt ?? 0) < Date.now() - PERIOD_MS;
    const forced = (needsNote || staleVoice) && (s.lastRunAt ?? 0) < Date.now() - 60_000;
    if (s.inFlight) { if (kick) kicks.set(sess.id, kick); continue; }   // kick conservé : re-consommé après l'analyse
    const dispatch = (force: boolean) => {
      void analyseOnce(sess.id, sess.title ?? sess.id.slice(0, 12), sess.location?.directory, stt.status, force);
    };
    if (kick?.start) { dispatch(true); continue; }       // prompt reçu → cadrage immédiat
    if (kick?.end) { dispatch(false); continue; }        // tour fini → analyse de clôture
    if (busyPeriodic) { dispatch(false); continue; }
    if (forced) { dispatch(true); continue; }
    // ici : session idle qui n'a pas bougé — le compagnon ne fait RIEN (c'est le fix anti-relance)
  }
}

export function verdictOf(sid: string) { return getVerdict(sid); }
export function companionSessionOf(sid: string) { return get(sid).compSession ?? null; }
