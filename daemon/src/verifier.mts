/**
 * Le vérificateur : une sous-conversation enfant de la tâche (agent
 * `superviseur-verificateur`, nom FIXE sans hash, quincallerie compagnon
 * réutilisée). Une seule session par tâche, réutilisée pour TOUTES les
 * vérifications : il garde le fil de la liste, des preuves déjà jugées et des
 * retraits. Le daemon applique son JSON (machine à états de criteria.mts) et
 * notifie l'agent principal de chaque transition.
 *
 * Déclencheurs : tool criteria (add/remove/update/to_validate), fin de tour de
 * la tâche. Garde-fous compagnon : intervalle minimal, dédoublonnage par
 * signature de l'état critères, une phase à la fois, concurrence limitée ; 60 s
 * de refroidissement après une phase qui a modifié la liste (anti-boucle).
 */
import {
  VERIFIER_AGENT, ensureVerifierDefinition, getTaskState, getVerifier, logEvent, putVerifier,
  setVerifierSignature,
} from './state.mts';
import {
  CriteriaError, approveCriterion, addCriterion, criteriaCounts, criteriaSignature,
  listCriteria, proposeRemoval, rejectCriterion, statusLabel, updateCriterion,
} from './criteria.mts';
import { takeVerifierKick } from './verifier-kicks.mts';
import { toolActionLine } from './verdict.mts';

let base = '';
export function setVerifierBase(b: string) { base = b.replace(/\/$/, ''); }

const MIN_INTERVAL_MS = Number(process.env.SUPERVISEUR_VERIFIER_MIN_INTERVAL_MS ?? 20_000);
/** Après une phase qui a modifié la liste (suggestions appliquées). */
const CHANGE_COOLDOWN_MS = 60_000;
const MAX_CONCURRENT = Number(process.env.SUPERVISEUR_VERIFIER_CONCURRENCY ?? 2);
const MAX_WAIT_MS = 150_000;
const REPAIR_WAIT_MS = 60_000;
const MAX_INJECT_CHARS = 9000;
const MAX_ACTIONS = 12;
const MAX_EXCERPT_MESSAGES = 8;

interface VerifierState {
  verifierSession?: string;
  inFlight?: boolean;
  ensuring?: boolean;
  lastRunAt?: number;
  cooldownUntil?: number;
  failures?: number;
}
const st = new Map<string, VerifierState>();
let active = 0;

function get(sid: string): VerifierState {
  let s = st.get(sid);
  if (!s) st.set(sid, s = {});
  return s;
}

async function jget(path: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  } finally { clearTimeout(t); }
}

async function jpost(path: string, body: unknown, timeoutMs = 30_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* pas JSON */ }
    return { status: res.status, ok: res.ok, data };
  } finally { clearTimeout(t); }
}

/* --- Session du vérificateur (quincallerie compagnon) --- */

type Presence = 'alive' | 'gone' | 'archived' | 'unknown';

async function verifierPresence(verifierId: string): Promise<Presence> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${encodeURIComponent(verifierId)}`, { signal: controller.signal });
    if (res.status === 404) return 'gone';
    if (!res.ok) return 'unknown';
    const body = await res.json() as { data?: { id?: string; time?: { archived?: number } } };
    if (body?.data?.id !== verifierId) return 'unknown';
    return body.data.time?.archived ? 'archived' : 'alive';
  } catch { return 'unknown'; }
  finally { clearTimeout(timeout); }
}

async function ensureVerifier(taskId: string, s: VerifierState): Promise<string> {
  const known = getVerifier(taskId);
  if (known) {
    const presence = await verifierPresence(known.verifierId);
    if (presence === 'alive') {
      s.verifierSession = known.verifierId;
      return known.verifierId;
    }
    if (presence === 'unknown') throw new Error('état de la session vérificateur inconnu');
    s.verifierSession = undefined;
    logEvent(taskId, 'note', `vérificateur ${presence === 'gone' ? 'supprimé' : 'archivé'} : recréation`);
  }
  const agent = ensureVerifierDefinition();
  // une seule session pour toutes les vérifications de la tâche : le fil
  // (preuves jugées, rejets, ajouts) reste dans la conversation de l'enfant
  const r = await jpost('/api/session', { parentID: taskId, title: 'verif. critères', agent });
  const id = (r.data as { data?: { id?: string } })?.data?.id;
  if (!id) throw new Error('session vérificateur non créée');
  s.verifierSession = id;
  putVerifier(taskId, id, agent);
  logEvent(taskId, 'note', `vérificateur #${id.slice(-6)} (${agent})`);
  return id;
}

/* --- Réponse du vérificateur --- */

interface WireMessage {
  id?: string;
  type?: string;
  time?: { created?: number };
  text?: string;
  content?: Array<{ type: string; text?: string } & { state?: { input?: Record<string, unknown> } }>;
}

function messageText(m: WireMessage): string {
  if (typeof m.text === 'string' && m.text.trim()) return m.text;
  return (m.content ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join(' ').trim();
}

interface VerifierJson {
  review?: unknown;
  notes?: unknown;
  actions?: unknown;
}

/** Parse le premier objet JSON d'une réponse ; exige un objet (actions facultatif). */
export function parseVerifierJson(text: string): VerifierJson | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as VerifierJson;
  } catch { return null; }
}

/**
 * Dernière réponse utile du vérificateur, la PLUS RÉCENTE d'abord : le listing
 * OpenChamber est descendant, prendre le dernier élément filtré renvoie le plus
 * ancien (souvent un assistant sans texte, d'où des attentes de 150 s pour rien).
 * On scanne du plus récent au plus ancien et on s'arrête au premier JSON
 * parsable ; à défaut, on rend le texte le plus récent.
 */
export function newestVerifierReply(messages: WireMessage[], sinceMs: number): { text: string; parses: boolean } | null {
  const replies = messages
    .filter(m => m.type === 'assistant' && (m.time?.created ?? 0) >= sinceMs)
    .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
  for (const m of replies) {
    const text = messageText(m);
    if (text && parseVerifierJson(text)) return { text, parses: true };
  }
  for (const m of replies) {
    const text = messageText(m);
    if (text) return { text, parses: false };
  }
  return null;
}

async function waitReply(verifierId: string, sinceMs: number, timeoutMs = MAX_WAIT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const out = await jget(`/api/session/${verifierId}/message?limit=6`) as { data?: WireMessage[] };
      const found = newestVerifierReply(out.data ?? [], sinceMs);
      if (found) {
        lastText = found.text;
        // dès que le texte parse en JSON vérificateur, on s'arrête
        if (found.parses) return found.text;
      }
    } catch { /* réseau : on retente */ }
  }
  return lastText;
}

async function repairReply(verifierId: string, dir: string | undefined, why: string): Promise<string> {
  const prompt = [
    `Ta réponse précédente est illisible (${why}).`,
    'Réécris UNIQUEMENT le JSON complet : {"review":"ok","notes":"...","actions":[...]},',
    'actions vide autorisée ([]). Clés en anglais, textes en français, un seul bloc JSON.',
  ].join('\n');
  const p = await jpost(`/api/openchamber/sessions/${verifierId}/send`, {
    prompt, agent: VERIFIER_AGENT, directory: dir,
  });
  if (!p.ok) return '';
  return waitReply(verifierId, Date.now() - 1500, REPAIR_WAIT_MS);
}

/* --- Injection --- */

interface WirePart { type?: string; name?: string; tool?: string; state?: { input?: Record<string, unknown>; status?: string } }

async function conversationExcerpt(taskId: string): Promise<string> {
  try {
    const out = await jget(`/api/session/${taskId}/message?limit=30`) as { data?: WireMessage[] };
    const conv = (out.data ?? [])
      .filter(m => m.type === 'user' || m.type === 'assistant')
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
      .slice(-MAX_EXCERPT_MESSAGES);
    const parts: string[] = [];
    for (const m of conv) {
      let txt = messageText(m).slice(0, 500);
      if (!txt && m.type === 'assistant') {
        txt = (m.content ?? []).filter(p => p.type === 'reasoning').map(p => p.text ?? '').join(' ').slice(0, 300);
      }
      const tag = m.type === 'user' ? '[PROPRIO]' : '[AGENT]';
      if (txt) parts.push(`${tag} ${txt}`);
      for (const c of m.content ?? []) {
        const line = toolActionLine(c);
        if (line) parts.push(line);
      }
    }
    return parts.join('\n') || '(conversation vide)';
  } catch { return '(conversation illisible pour le moment)'; }
}

function criteriaText(taskId: string, lastUpdateAt?: number): string {
  const rows = listCriteria(taskId);
  if (!rows.length) return '(aucun critère)';
  return rows.map(r => {
    const lines = [
      `${r.ref} [${statusLabel(r.status)}] (version ${r.version}) ${r.title}`,
      r.detail ? `    détail : ${r.detail}` : '',
    ];
    if (r.methods.length) lines.push(`    méthodes : ${r.methods.join(', ')}`);
    for (const ev of r.evidence.slice(0, 3)) {
      const loc = ev.path ? (ev.start_line ? ` (${ev.path} lignes ${ev.start_line}-${(ev.start_line ?? 1) + (ev.line_count ?? 1) - 1})` : ` (${ev.path})`) : '';
      lines.push(`    preuve [${ev.kind}]${loc} : ${ev.text.slice(0, 400)}`);
    }
    if (r.review) lines.push(`    dernier commentaire : ${r.review.slice(0, 300)}`);
    if (r.remove_proposed_at != null) {
      lines.push(`    RETRAIT PROPOSÉ : ${r.remove_reason ?? ''} : déjà enregistré, ne le re-propose pas ; il partira si l'agent confirme`);
    }
    if (r.status === 'validated' && r.validated_at != null && lastUpdateAt != null && r.validated_at < lastUpdateAt) {
      lines.push(`    VALIDÉ AVANT LES DERNIÈRES MODIFICATIONS : le travail a bougé depuis l'approbation : recoupe ou suggère une revalidation (update).`);
    }
    return lines.filter(Boolean).join('\n');
  }).join('\n');
}

/* --- Application du JSON et notification --- */

interface AppliedTransition {
  ref: string;
  op: string;
  line: string;
}

/** Lignes de notification : une par transition, structurées (P5). */
export function transitionLines(applied: AppliedTransition[]): string {
  return applied.map(t => t.line);
}

function versionOf(a: Record<string, unknown>): number | undefined {
  const raw = a.submission_version ?? a.submissionVersion ?? a.version;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function actionLine(op: string, ref: string, a: Record<string, unknown>): string {
  const reason = String(a.reason ?? '').trim();
  const comment = String(a.comment ?? '').trim();
  if (op === 'approve') return `${ref} validé${comment ? ` : ${comment}` : ' : preuve acceptée'}`;
  if (op === 'reject') return `${ref} à corriger : ${reason || 'raison non fournie'}`;
  if (op === 'add') {
    const title = String(a.title ?? '').trim();
    const detail = String(a.detail ?? '').trim();
    const methods = Array.isArray(a.methods) ? a.methods.map(String) : [];
    return `${ref} ajouté par le vérificateur : « ${title} »${detail ? ` : ${detail}` : ''}${methods.length ? ` (méthodes : ${methods.join(', ')})` : ''}${reason ? ` : ${reason}` : ''}`;
  }
  if (op === 'remove') return `${ref} : retrait proposé par le vérificateur : ${reason || 'raison non fournie'} : confirme avec criteria_remove, ou refuse en modifiant le critère`;
  if (op === 'update') return `${ref} modifié par le vérificateur : ${reason || 'sans raison fournie'}`;
  return `${ref} : ${op}`;
}

function addRefOf(taskId: string): string {
  // addCriterion renvoie la ligne ; pour la notification, relire le dernier créé
  const rows = listCriteria(taskId);
  return rows[rows.length - 1]?.ref ?? 'AC-??';
}

export function applyVerifierActions(taskId: string, json: VerifierJson): AppliedTransition[] {
  const applied: AppliedTransition[] = [];
  const actions = Array.isArray(json.actions) ? json.actions.slice(0, MAX_ACTIONS) : [];
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();
    const ref = String(a.ref ?? '').trim();
    try {
      if (op === 'approve') {
        approveCriterion(taskId, ref, String(a.comment ?? ''), versionOf(a));
        applied.push({ ref, op, line: actionLine('approve', ref, a) });
      } else if (op === 'reject') {
        rejectCriterion(taskId, ref, String(a.reason ?? ''), versionOf(a));
        applied.push({ ref, op, line: actionLine('reject', ref, a) });
      } else if (op === 'add') {
        const title = String(a.title ?? '').trim();
        addCriterion(taskId, { title, detail: String(a.detail ?? ''), methods: a.methods }, 'verifier');
        const addedRef = addRefOf(taskId);
        applied.push({ ref: addedRef, op, line: actionLine('add', addedRef, a) });
      } else if (op === 'remove') {
        // jamais de suppression physique par le vérificateur : une PROPOSITION
        // persistée, que l'agent confirme (criteria_remove) ou refuse (update)
        proposeRemoval(taskId, ref, String(a.reason ?? ''));
        applied.push({ ref, op, line: actionLine('remove', ref, a) });
      } else if (op === 'update') {
        updateCriterion(taskId, ref, {
          title: a.title != null ? String(a.title) : undefined,
          detail: a.detail != null ? String(a.detail) : undefined,
          methods: a.methods,
        }, 'verifier');
        applied.push({ ref, op, line: actionLine('update', ref, a) });
      } else {
        logEvent(taskId, 'note', `vérificateur : action ignorée (${op || 'vide'} ${ref})`);
      }
    } catch (e) {
      // transition impossible : état inattendu, ref inconnu ou JUGEMENT PÉRIMÉ
      // (le critère a changé pendant la phase) : ignoré, le daemon garde la main
      const msg = e instanceof CriteriaError ? `${e.code} : ${e.message}` : String((e as Error)?.message ?? e);
      logEvent(taskId, 'note', `vérificateur : ${op} ${ref} refusé (${msg.slice(0, 140)})`);
    }
  }
  return applied;
}

/**
 * Notification à l'agent principal : UN message par phase, avec les lignes
 * structurées (justification d'approbation, détail des ajouts, attentes des
 * corrections). Livraison `steer` avec reprises (3 essais) ; en cas d'échec
 * final, repli sur la file d'attente OpenChamber (qui exige le sendConfig de
 * la session, repris de /api/session/:id).
 */
/** Exportée pour verifierNotify.test.mts ; appelée par runPhase. */
export async function notifyMainAgent(taskId: string, applied: AppliedTransition[]): Promise<void> {
  const head = 'Ne réponds pas à ce message : applique les corrections nécessaires.';
  const text = `[superviseur] Critères : ${transitionLines(applied)}. ${head}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await jpost(`/api/session/${taskId}/prompt`, { text, delivery: 'steer' }, 8000);
    if (out.ok) return;
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
  }
  const queued = await queueFallback(taskId, text);
  logEvent(taskId, 'note', queued
    ? 'notification critères : steer échoué, mise dans la file d\'attente'
    : 'notification critères : steer ET file d\'attente échoués (reprise au prochain kick)');
}

async function queueFallback(taskId: string, text: string): Promise<boolean> {
  try {
    const meta = await jget(`/api/session/${taskId}`) as {
      data?: { model?: { providerID?: string; id?: string }; location?: { directory?: string } };
    };
    const model = meta?.data?.model;
    const directory = meta?.data?.location?.directory;
    if (!model?.providerID || !model?.id || !directory) return false;
    const out = await jpost(`/api/message-queue/sessions/${taskId}/items`, {
      directory,
      item: {
        text,
        sendConfig: { providerID: model.providerID, modelID: model.id },
      },
    }, 8000);
    return !!out.ok;
  } catch {
    return false;
  }
}

/* --- Phase --- */

async function runPhase(taskId: string, title: string, dir: string | undefined, lastUpdateAt?: number): Promise<void> {
  const s = get(taskId);
  const rows = listCriteria(taskId);
  if (!rows.length) return;
  const sig = criteriaSignature(taskId);
  const pending = rows.filter(r => r.status === 'to_validate').length;
  // dédoublonnage PERSISTÉ : la signature de l'état critères déjà jugé vit en
  // DB (verifier_map.signature), donc un redémarrage du daemon ne relance pas
  // une phase à vide ; seuls un kick, une preuve en attente ou un changement
  // d'état déclenchent
  const stored = getVerifier(taskId)?.signature ?? undefined;
  if (stored === sig && pending === 0) return;

  s.inFlight = true;
  active++;
  try {
    const counts = criteriaCounts(rows);
    const objective = (getTaskState(taskId) as { objective?: string } | null)?.objective ?? '';
    const excerpt = await conversationExcerpt(taskId);
    const inject = [
      `Tâche : ${title}`,
      `Objectif actuel : ${objective || 'inconnu'}`,
      `Critères (${counts.validated}/${counts.total} validés) :`,
      criteriaText(taskId, lastUpdateAt),
      pending ? `${pending} preuve(s) attend(ent) un jugement.` : 'Aucune preuve en attente de jugement.',
      'Extrait récent de la conversation de l\'agent principal :',
      excerpt,
      'Consignes : juge les preuves « à valider » (recoupe avec les outils de lecture si nécessaire), propose les ajustements de la liste, surveille la cohérence. Réponds par le JSON seul.',
    ].join('\n\n').slice(0, MAX_INJECT_CHARS);

    const verifierId = await ensureVerifier(taskId, s);
    logEvent(taskId, 'note', `vérificateur : phase envoyée (${counts.toValidate} preuve(s) à juger)`);
    const p = await jpost(`/api/openchamber/sessions/${verifierId}/send`, {
      prompt: inject, agent: VERIFIER_AGENT, directory: dir,
    });
    if (!p.ok) throw new Error(`prompt vérificateur → ${p.status}`);

    const reply = await waitReply(verifierId, Date.now() - 1500);
    logEvent(taskId, 'note', `vérificateur : réponse reçue (${reply ? `${reply.length} car.` : 'vide'})`);
    let json = parseVerifierJson(reply);
    if (!json) {
      logEvent(taskId, 'note', 'vérificateur : réponse illisible (reprise unique)');
      const repaired = await repairReply(verifierId, dir, 'JSON absent ou non parsable');
      json = parseVerifierJson(repaired);
      if (!json) {
        logEvent(taskId, 'note', 'vérificateur : réponse toujours illisible, aucun changement appliqué');
        // signature et kick non consommés : la phase repartira
        return;
      }
    }

    const applied = applyVerifierActions(taskId, json);
    const notes = String(json.notes ?? '').trim().slice(0, 300);
    s.lastRunAt = Date.now();
    s.failures = 0;
    // l'état critères (post-application) est marqué « jugé » en DB : un
    // redémarrage ne relance pas de phase tant que rien n'a changé
    setVerifierSignature(taskId, criteriaSignature(taskId));
    logEvent(taskId, 'note', `vérificateur : ${applied.length} transition(s)${notes ? ` : ${notes}` : ''}`, {
      applied: applied.map(t => `${t.op}:${t.ref}`),
    });
    if (applied.length) {
      // refroidissement anti-boucle : la prochaine phase attend
      s.cooldownUntil = Date.now() + CHANGE_COOLDOWN_MS;
      await notifyMainAgent(taskId, applied);
    }
  } catch (e) {
    const failures = (s.failures ?? 0) + 1;
    s.failures = failures;
    logEvent(taskId, 'note', `vérificateur : échec ${String(e).slice(0, 100)}`);
  } finally {
    s.inFlight = false;
    active = Math.max(0, active - 1);
    s.lastRunAt = Date.now();
  }
}

interface TickSession {
  id: string;
  title?: string;
  parentID?: string;
  location?: { directory?: string };
  time?: Record<string, number>;
}

/**
 * Appelé à chaque tick de flotte. Ne tourne que sur déclencheur : kick
 * (tool criteria ou fin de tour), preuve en attente, ou signature changée.
 */
export async function verifierTick(
  sessions: TickSession[],
  statusMap: Record<string, { status: string; lastUpdateAt?: number }>,
): Promise<void> {
  if (process.env.SUPERVISEUR_VERIFIER === 'off' || process.env.SUPERVISEUR_CRITERIA === 'off') return;
  for (const sess of sessions) {
    if (sess.parentID) continue;                  // jamais une sous-session
    if (sess.time?.archived) continue;
    const taskId = sess.id;
    // comme le compagnon : la sous-conversation vérificateur existe pour toute
    // tâche, même sans critère encore (créée au premier tick, réutilisée ensuite)
    if (!getVerifier(taskId)) {
      const s = get(taskId);
      if (!s.ensuring) {
        s.ensuring = true;
        void ensureVerifier(taskId, s)
          .catch((e) => logEvent(taskId, 'note', `vérificateur : création impossible ${String(e).slice(0, 80)}`))
          .finally(() => { s.ensuring = false; });
      }
      continue;
    }
    const rows = listCriteria(taskId);
    if (!rows.length) continue;
    const s = get(taskId);
    if (s.inFlight) continue;
    if (active >= MAX_CONCURRENT) break;
    if (!statusMap[taskId]) continue;

    const k = takeVerifierKick(taskId);
    const now = Date.now();
    const due = now - (s.lastRunAt ?? 0) >= MIN_INTERVAL_MS;
    const pending = rows.some(r => r.status === 'to_validate');
    // signature déjà jugée persistée en DB : survit aux redémarrages du daemon
    if (!k && !pending && (getVerifier(taskId)?.signature ?? undefined) === criteriaSignature(taskId)) continue;
    // un kick critère (transition explicite de l'agent) passe l'intervalle :
    // il est consommé ici, le repousser le perdrait sans autre déclencheur
    if (!due && !k?.criteria) continue;
    if (s.cooldownUntil && now < s.cooldownUntil && !k?.criteria) continue;

    void runPhase(taskId, sess.title ?? taskId.slice(0, 12), sess.location?.directory, statusMap[taskId]?.lastUpdateAt);
  }
}

/** Pour les tests : remet l'état mémoire à zéro. */
export function resetVerifierState() {
  st.clear();
  active = 0;
}
