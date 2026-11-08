/**
 * Le compagnon : une session analyste (agent `superviseur-analyste` global, sans tool)
 * par session supervisée. Il produit un verdict JSON, mais le daemon garde la main :
 * - l'attente humaine vient des formulaires/permissions réels ou d'une question
 *   explicite de l'agent, jamais d'une invention de l'analyste ;
 * - la progression vient d'un plan stocké, pas d'un pourcentage improvisé ;
 * - `done` implique 100, et un objectif qui change remet le plan à zéro ;
 * - un digest inchangé n'est pas réanalysé (dédoublonnage + intervalle minimal).
 * Le verdict n'est qu'un SIGNAL : la clôture reste un geste humain (doc 03).
 */
import { createHash } from 'node:crypto';
import {
  ensureAgentDefinition, getAgentVersion, getCompanion, getTaskState, getVerdict, logEvent,
  putCompanion, setTaskObjective, setTaskPlan, upsertVerdict,
} from './state.mts';
import { getPlanSnapshot, planStepsOf } from './plan.mts';
import { criteriaCounts, criteriaPushMessage, listCriteria, statusLabel } from './criteria.mts';
import { takeKick, kick as pushKick } from './kicks.mts';
import { isDaemonNotice, messageText } from './messages.mts';
import {
  detectHumanQuestion, emptyWait, lintSummary, normalizeVerdict, parsePlanFromDb,
  parseVerdictText, resolveObjective, scrubSummary, shouldRepair, toolActionLine,
  type NormalizedVerdict, type PlanStep, type RawVerdict, type WaitInfo,
} from './verdict.mts';

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

const PERIOD_MS = Number(process.env.SUPERVISEUR_COMPANION_PERIOD_MS ?? 5 * 60_000);
/** Deux analyses de la même session ne peuvent pas être plus proches que ça. */
const MIN_INTERVAL_MS = Number(process.env.SUPERVISEUR_COMPANION_MIN_INTERVAL_MS ?? 20_000);
/** Analyses simultanées toutes sessions confondues (le modèle local reste réactif). */
const MAX_CONCURRENT = Number(process.env.SUPERVISEUR_COMPANION_CONCURRENCY ?? 3);
const MAX_WAIT_MS = 150_000;
const REPAIR_WAIT_MS = 60_000;
const MAX_INJECT_CHARS = 6000;
const MAX_DIGEST_MESSAGES = 6;
const MAX_ACTIONS = 8;
const COMPANION_CHECK_INTERVAL_MS = 15_000;

interface CompanionState {
  compSession?: string;
  inFlight?: boolean;
  lastMsgID?: string;
  lastDigestHash?: string;
  lastRunAt?: number;
  lastStatus?: string;
  lastMigrationAt?: number;
  lastCriteriaPush?: string;
  failures?: number;
}
const st = new Map<string, CompanionState>();
let active = 0;
let ticking = false;
const lastCompanionCheck = new Map<string, { id: string; at: number }>();

function get(sid: string): CompanionState {
  let s = st.get(sid);
  if (!s) st.set(sid, s = {});
  return s;
}

async function jpost(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* pas JSON */ }
  return { status: res.status, ok: res.ok, data };
}

async function jget(path: string) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

type CompanionPresence = 'alive' | 'gone' | 'archived' | 'unknown';

/** Vérifie directement la session : le répertoire peut être paginé ou en retard. */
async function companionPresence(compId: string): Promise<CompanionPresence> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/session/${encodeURIComponent(compId)}`, { signal: controller.signal });
    if (res.status === 404) return 'gone';
    if (!res.ok) return 'unknown';
    const body = await res.json() as {
      data?: { id?: string; time?: { archived?: number } };
    };
    if (body?.data?.id !== compId) return 'unknown';
    return body.data.time?.archived ? 'archived' : 'alive';
  } catch { return 'unknown'; }
  finally { clearTimeout(timeout); }
}

interface ToolPart {
  type?: string; name?: string; tool?: string;
  state?: { status?: string; input?: Record<string, unknown> };
}
interface WireMessage {
  id: string;
  type: string;
  time?: { created?: number };
  text?: string;
  content?: Array<{ type: string; text?: string } & ToolPart>;
  payload?: { text?: string };
}

interface DigestResult {
  text: string;
  hash: string;
  lastMsgID?: string;
  lastUser?: { id: string; text: string };
  lastAssistantText: string;
  agentAsk: string | null;
  actions: string[];
}

/** Premier message humain de la session (objectif initial, pas seulement la fenêtre récente). */
async function firstUserText(sid: string): Promise<string> {
  try {
    const first = await jget(`/api/session/${sid}/message?limit=20&order=asc`) as { data?: WireMessage[] };
    const conv = (first.data ?? [])
      .filter(m => m.type === 'user' && !isDaemonNotice(m))   // une notification du daemon n'est pas l'objectif initial
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
    return messageText(conv[0] ?? ({ type: 'user' } as WireMessage));
  } catch { return ''; }
}

async function digestNew(sid: string, s: CompanionState, force: boolean): Promise<DigestResult | null> {
  const out = await jget(`/api/session/${sid}/message?limit=30`) as { data?: WireMessage[] };
  const conv = (out.data ?? [])
    .filter(m => m.type === 'user' || m.type === 'assistant')
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  if (!conv.length) return null;

  const lastUserMsg = [...conv].reverse().find(m => m.type === 'user' && !isDaemonNotice(m));
  const lastUser = lastUserMsg
    ? { id: lastUserMsg.id, text: messageText(lastUserMsg) }   // texte COMPLET : l'objectif est la consigne entière, pas un extrait
    : undefined;

  // du frais : messages apparus depuis la dernière analyse ; premier passage ou force = les 4 derniers
  const idx = s.lastMsgID ? conv.findIndex(m => m.id === s.lastMsgID) : -1;
  let fresh = idx >= 0 ? conv.slice(idx + 1) : conv.slice(-4);
  if (force && !fresh.length) fresh = conv.slice(-4);
  fresh = fresh.slice(-MAX_DIGEST_MESSAGES);
  if (!fresh.length) return null;

  const parts: string[] = [];
  const actions: string[] = [];
  for (let i = 0; i < fresh.length; i++) {
    const m = fresh[i];
    let txt = messageText(m);
    let tag = (i === fresh.length - 1 && m.type === 'assistant')
      ? 'AGENT (DERNIER MESSAGE, état le plus récent du travail)'
      : (m.type === 'user' ? 'TOI (message du propriétaire de la session)' : 'AGENT');
    if (!txt && m.type === 'assistant') {
      // tour en cours : souvent des tool calls sans texte, le raisonnement révèle l'activité
      const reasoning = (m.content ?? [])
        .filter(c => c.type === 'reasoning')
        .map(c => c.text ?? '')
        .join(' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .trim();
      if (reasoning) {
        txt = reasoning.slice(0, 400);
        tag = 'AGENT (raisonnement en cours, ne le recopie pas)';
      }
    }
    if (txt) parts.push(`[${tag}] ${txt}`.slice(0, 900));
    for (const c of m.content ?? []) {
      const line = toolActionLine(c);
      if (line) actions.push(line);
    }
  }

  const actionLines = actions.slice(-MAX_ACTIONS);
  if (actionLines.length) parts.push(`Actions récentes (faits):\n${actionLines.join('\n')}`);
  if (!parts.length) {
    parts.push('(aucun texte nouveau pour l’instant : le tour vient de démarrer. Résume l’objectif et ce que l’agent fait, sans décrire l’extrait.)');
  }

  const lastAssistant = [...conv].reverse().find(m => m.type === 'assistant');
  const lastAssistantText = lastAssistant
    ? (messageText(lastAssistant)
      || (lastAssistant.content ?? []).filter(c => c.type === 'reasoning').map(c => c.text ?? '').join(' ').slice(0, 400))
    : '';
  const agentAsk = detectHumanQuestion(lastAssistantText);

  const text = parts.join('\n');
  return {
    text,
    hash: createHash('sha1').update(text).digest('hex'),
    lastMsgID: conv[conv.length - 1]?.id,
    lastUser,
    lastAssistantText,
    agentAsk,
    actions: actionLines,
  };
}

function persistedCompanion(sid: string) { return getCompanion(sid); }
function rememberCompanion(sid: string, compId: string, agent: string) { putCompanion(sid, compId, agent); }

async function ensureCompanion(sid: string, s: CompanionState) {
  const known = persistedCompanion(sid);
  const currentV = getAgentVersion();
  const currentAgent = ensureAgentDefinition(currentV);
  // prompt changé, ou compagnon créé avec l'ancien nom d'agent (dont le prompt est resté en cache) ?
  if (known && (known.version !== currentV || known.agent !== currentAgent)) {
    try {
      await jpost('/api/openchamber/sessions/archive', { ids: [known.compId] });
      logEvent(sid, 'note', 'compagnon déclassé (prompt de l’analyste a changé)');
    } catch { /* garde le jeton */ }
    s.compSession = undefined;
  } else if (known) {
    const presence = await companionPresence(known.compId);
    if (presence === 'alive') {
      s.compSession = known.compId;
      return known.compId;
    }
    if (presence === 'unknown') throw new Error('état de la session compagnon inconnu');
    s.compSession = undefined;
    logEvent(sid, 'note', `compagnon ${presence === 'gone' ? 'supprimé' : 'archivé'} : recréation`);
  }
  // l'agent est fixé dès la création : l'API send ne l'impose pas toujours aux sessions enfants
  const r = await jpost('/api/session', { parentID: sid, title: 'comp. supervision', agent: currentAgent });
  const id = (r.data as { data?: { id?: string } })?.data?.id;
  if (!id) throw new Error('session compagnon non créée');
  s.compSession = id;
  rememberCompanion(sid, id, currentAgent);
  logEvent(sid, 'note', `compagnon #${id.slice(-6)} (${currentAgent})`);
  return id;
}

async function waitReply(compId: string, sinceMs: number, timeoutMs = MAX_WAIT_MS): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const stt = await jget(`/api/session/${compId}/message?limit=6`) as {
        data?: Array<{ type: string; time?: { created?: number }; content?: Array<{ type: string; text?: string }> }>;
      };
      // le listing est DESCENDANT : la réponse utile est la plus récente, pas
      // la dernière du tableau filtré (les assistants sans texte, tool calls,
      // la précédaient et faisaient attendre le délai complet pour rien)
      const replies = (stt.data ?? [])
        .filter(m => m.type === 'assistant' && (m.time?.created ?? 0) >= sinceMs)
        .sort((a, b) => (b.time?.created ?? 0) - (a.time?.created ?? 0));
      for (const m of replies) {
        const text = m?.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join(' ') ?? '';
        if (!text) continue;
        lastText = text;
        // dès que le texte parse en verdict, on s'arrête : le marqueur "complété" arrive en retard
        if (parseVerdictText(text)) return text;
        break;   // le texte le plus récent ne parse pas : on continue de poller
      }
    } catch { /* réseau : on retente */ }
  }
  return lastText;
}

async function repairVerdict(compId: string, dir: string | undefined, reasons: string[]): Promise<string> {
  const prompt = [
    `Ta réponse précédente ne respecte pas le contrat (${reasons.join(', ')}).`,
    'Réécris UNIQUEMENT le JSON complet, en français, avec toutes les clés.',
    'Rappels : summary = ce qui est vrai maintenant pour un lecteur qui n’a pas lu la conversation, 1 à 2 phrases, l’agent à la troisième personne (jamais « tu fais » pour l’agent).',
    'Aucun identifiant, commit, branche, numéro de document, nom d’outil, fichier, test, pourcentage, backtick, ni « idle », « busy », « extrait », « aucun changement ».',
    'Décris l’effet concret pour le lecteur, pas le journal de bord du développeur.',
    '« le compagnon » ne désigne jamais l’agent : écris « l’agent ».',
    'human_request vide si le signal d’attente est « aucun ». progress peut rester null, le daemon calcule à partir du plan.',
    'Réponds par le JSON seulement.',
  ].join('\n');
  const p = await jpost(`/api/openchamber/sessions/${compId}/send`, {
    prompt, agent: ensureAgentDefinition(getAgentVersion()), directory: dir,
  });
  if (!p.ok) return '';
  return waitReply(compId, Date.now() - 1500, REPAIR_WAIT_MS);
}

function planText(plan: PlanStep[]): string {
  return plan.length
    ? plan.map((p, i) => `${i + 1}. [${p.done ? 'x' : ' '}] ${p.step}`).join('\n')
    : '(aucun plan encore)';
}

function fallbackSummary(previous: string | null, objective: string): string {
  const prev = scrubSummary(previous ?? '');
  if (prev && lintSummary(prev).ok) return prev;
  return `L’agent travaille sur : ${objective.slice(0, 140)}`;
}

async function analyseOnce(
  sid: string,
  title: string,
  dir: string | undefined,
  status: string | undefined,
  wait: WaitInfo,
  force = false,
): Promise<void> {
  const s = get(sid);
  if (s.inFlight) return;
  if (active >= MAX_CONCURRENT) return;
  s.inFlight = true;
  active++;
  try {
    const digest = await digestNew(sid, s, force);
    if (!digest) { s.lastRunAt = Date.now(); return; }
    const busy = status === 'busy';

    const prevTask = getTaskState(sid) as {
      goal?: string; objective?: string; objective_version?: number;
      last_user_id?: string; plan?: string; closed_at?: number;
    } | null;
    const firstUser = prevTask?.goal ? '' : await firstUserText(sid);
    const objective = resolveObjective({ prev: prevTask, lastUser: digest.lastUser, firstUser });
    const prevPlan = parsePlanFromDb(prevTask?.plan);
    // Le plan est la propriété de la session de travail : on le relit depuis
    // son `planwrite`. Un nouvel objectif repart sans plan tant que la tâche
    // n'a pas reposé sa liste.
    const planSnap = await getPlanSnapshot(sid);
    const planSteps = objective.changed ? [] : planStepsOf(planSnap);

    // même digest, même statut, pas de nouvel objectif → aucun appel au modèle
    if (!force && !objective.changed && digest.hash === s.lastDigestHash && s.lastStatus === status) {
      s.lastMsgID = digest.lastMsgID ?? s.lastMsgID;
      s.lastRunAt = Date.now();
      return;
    }
    setTaskObjective(sid, {
      objective: objective.objective,
      version: objective.version,
      goal: objective.goal || undefined,
      lastUserId: objective.lastUserId,
    });
    if (objective.changed) {
      setTaskPlan(sid, []);
      logEvent(sid, 'note', `nouvel objectif (v${objective.version})`);
    }

    const previousVerdict = getVerdict(sid) as {
      resume?: string; progress?: number | null;
      termine?: number; attend?: string; state?: string;
    } | null;

    const compId = await ensureCompanion(sid, s);
    const planForInjection = planSteps;
    // l'analyste doit savoir que la tâche est censée porter des critères : liste
    // et état de chacun, ou l'absence explicite
    const critRows = listCriteria(sid);
    const critCounts = criteriaCounts(critRows);
    const criteriaInject = critRows.length
      ? `Critères d'acceptation (${critCounts.validated}/${critCounts.total} validés) :\n${critRows.map(r => `${r.ref} [${statusLabel(r.status)}] ${r.title}`).join('\n')}`
      : "Aucun critère d'acceptation défini pour cette tâche : l'agent est censé en définir avec criteria_add et soumettre ses preuves avec criteria_to_validate.";
    const waitText = wait.waiting
      ? `${wait.source}: ${wait.ask}`
      : (digest.agentAsk ? `agent_ask: ${digest.agentAsk}` : 'aucun');
    const prevText = previousVerdict
      ? `Verdict précédent (faits, ne le recopie pas) : summary="${scrubSummary(previousVerdict.resume ?? '').slice(0, 200)}" ; state=${previousVerdict.state ?? '?'} ; progress=${previousVerdict.progress ?? 'null'} ; done=${previousVerdict.termine ? 'true' : 'false'} ; attend="${previousVerdict.attend ?? ''}"`
      : 'Aucun verdict précédent.';

    const inject = [
      `Tâche : ${title}`,
      `Objectif actuel (version ${objective.version}) : ${objective.objective || 'inconnu'}`,
      `Plan de la tâche (planwrite, source de vérité) :\n${planText(planForInjection)}`,
      criteriaInject,
      'Le plan appartient à la session de travail. Ne crée pas de plan, ne le modifie pas, et ne produis pas de champ plan : la progression est calculée par le daemon depuis ce planwrite.',
      `Signal d’attente humaine : ${waitText}`,
      prevText,
      'Message(s) récent(s) :',
      digest.text,
      'Consignes : ton lecteur est le propriétaire humain ; l’agent supervisé n’est pas ton interlocuteur. Raconte le travail à la troisième personne. Si une information te manque, dis-le dans summary ou next : ne demande jamais au lecteur de relancer, vérifier ou opérer l’agent. Le JSON doit contenir TOUTES les clés, en français pour les textes.',
    ].filter(Boolean).join('\n\n').slice(0, MAX_INJECT_CHARS);

    const agent = ensureAgentDefinition(getAgentVersion());
    const p = await jpost(`/api/openchamber/sessions/${compId}/send`, {
      prompt: inject, agent, directory: dir,
    });
    if (!p.ok) throw new Error(`prompt compagnon → ${p.status}`);

    const reply = await waitReply(compId, Date.now() - 1500);
    let raw: RawVerdict | null = parseVerdictText(reply);
    if (!raw) {
      logEvent(sid, 'note', 'analyste: réponse illisible (gardé l’ancien)');
      // pas de lastMsgID ni de hash : la reprise doit revoir le même extrait
      s.lastDigestHash = undefined;
      s.lastStatus = undefined;
      return;
    }

    const ctx = {
      busy,
      wait,
      agentAsk: busy ? null : digest.agentAsk,
      objectiveChanged: objective.changed,
      objective: objective.objective,
      workPlan: planSteps,
      previous: {
        resume: previousVerdict?.resume ?? undefined,
        progress: previousVerdict?.progress ?? null,
        termine: previousVerdict?.termine ?? null,
        state: previousVerdict?.state ?? null,
        plan: prevPlan,
        attend: previousVerdict?.attend ?? undefined,
      },
    };
    let norm: NormalizedVerdict = normalizeVerdict(raw, ctx);

    if (shouldRepair(norm.lintReasons)) {
      logEvent(sid, 'note', `analyste: reprise (${norm.lintReasons.join(', ')})`);
      const repaired = await repairVerdict(compId, dir, norm.lintReasons);
      const raw2 = parseVerdictText(repaired);
      if (raw2) norm = normalizeVerdict(raw2, ctx);
    }

    // reprise insuffisante : on garde un texte honnête, jamais de bruit à l'écran
    if (shouldRepair(norm.lintReasons)) {
      norm.summary = fallbackSummary(previousVerdict?.resume ?? null, objective.objective);
    }

    if (norm.done) norm.plan = norm.plan.map(p => ({ ...p, done: true }));
    setTaskPlan(sid, norm.plan);
    upsertVerdict(sid, {
      resume: norm.summary,
      termine: norm.done,
      progress: norm.progress,
      attend: norm.attend,
      state: norm.state,
      humanSource: norm.humanSource,
      next: norm.next,
      objectiveVersion: objective.version,
    });
    s.lastDigestHash = digest.hash;
    s.lastStatus = status;
    s.lastMsgID = digest.lastMsgID ?? s.lastMsgID;
    s.failures = 0;
    logEvent(sid, 'note', `analyste: ${norm.summary}`, {
      progress: norm.progress, termine: norm.done,
      state: norm.state, source: norm.humanSource, plan: norm.plan.length,
    });
    // verdict done mais critères incomplets : le rappel part à l'agent
    // (note de l'analyste sinon message déterministe) ; un message identique
    // n'est pas repoussé, et l'état hors done réarme le rappel
    if (!norm.done) {
      s.lastCriteriaPush = undefined;
    } else if (!(prevTask?.closed_at)) {
      const msg = norm.criteriaNote || criteriaPushMessage(listCriteria(sid));
      if (msg && s.lastCriteriaPush !== msg) {
        s.lastCriteriaPush = msg;
        const push = await jpost(`/api/session/${sid}/prompt`, { text: `[superviseur] Critères : ${msg}`, delivery: 'steer' });
        logEvent(sid, 'note', push.ok ? `rappel critères poussé : ${msg.slice(0, 100)}` : `rappel critères refusé (${push.status})`);
      }
    }
  } catch (e) {
    const failures = (s.failures ?? 0) + 1;
    s.failures = failures;
    s.lastDigestHash = undefined;
    s.lastStatus = undefined;
    logEvent(sid, 'note', `analyste: échec ${String(e).slice(0, 80)}`);
    // une ou deux reprises, pas une boucle : le kick sera reconsumé après l'intervalle
    if (failures <= 2) pushKick(sid, 'end');
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
 * Appelé à chaque tick de flotte. Le compagnon ne tourne que sur un déclencheur :
 * kick start/end, migration de prompt, période busy ou réparation d'un enfant perdu.
 * Un digest inchangé est ignoré.
 */
export async function companionTick(
  sessions: TickSession[],
  statusMap: Record<string, { status: string; lastUpdateAt?: number }>,
  waitingMap: Map<string, WaitInfo> = new Map(),
): Promise<void> {
  if (process.env.SUPERVISEUR_COMPANION === 'off') return;
  if (ticking) return;
  ticking = true;
  try { await runCompanionTick(sessions, statusMap, waitingMap); }
  finally { ticking = false; }
}

async function runCompanionTick(
  sessions: TickSession[],
  statusMap: Record<string, { status: string; lastUpdateAt?: number }>,
  waitingMap: Map<string, WaitInfo>,
): Promise<void> {
  const currentV = getAgentVersion();
  const currentAgent = ensureAgentDefinition(currentV);

  // Priorité aux compagnons à migrer : sinon deux sessions busy peuvent prendre
  // tous les créneaux et affamer la migration des sessions au repos.
  const candidates = sessions.filter(s => !s.parentID && !s.time?.archived && !!statusMap[s.id]);
  const staleIds = new Set<string>();
  const missingIds = new Set<string>();
  const stale: TickSession[] = [];
  const normal: TickSession[] = [];
  const listedSessions = new Map(sessions.map(sess => [sess.id, sess]));
  for (const sess of candidates) {
    const known = getCompanion(sess.id);
    const stalePrompt = !known || known.version !== currentV || known.agent !== currentAgent;
    let missing = false;
    const listedCompanion = known ? listedSessions.get(known.compId) : undefined;
    if (known && (!listedCompanion || listedCompanion.time?.archived)) {
      const check = lastCompanionCheck.get(sess.id);
      if (!check || check.id !== known.compId || Date.now() - check.at >= COMPANION_CHECK_INTERVAL_MS) {
        lastCompanionCheck.set(sess.id, { id: known.compId, at: Date.now() });
        const presence = await companionPresence(known.compId);
        if (presence === 'gone' || presence === 'archived') {
          missing = true;
          missingIds.add(sess.id);
          get(sess.id).compSession = undefined;
          logEvent(sess.id, 'note', `compagnon ${presence === 'gone' ? 'supprimé' : 'archivé'} détecté : réparation`);
        }
      }
    } else if (known && listedCompanion) {
      lastCompanionCheck.delete(sess.id);
    }
    if (stalePrompt || missing) {
      staleIds.add(sess.id);
      stale.push(sess);
    } else {
      normal.push(sess);
    }
  }
  const ordered = [...stale, ...normal];

  for (const sess of ordered) {
    if (active >= MAX_CONCURRENT) break;
    const stt = statusMap[sess.id];
    const s = get(sess.id);
    if (s.inFlight) continue;
    // une carte fermée dans le Superviseur ne consomme pas d'analyse tant que la session n'a pas bougé
    const task = getTaskState(sess.id) as { closed_at?: number } | null;
    if (task?.closed_at && (stt.lastUpdateAt ?? 0) <= task.closed_at) continue;

    const wait = waitingMap.get(sess.id) ?? emptyWait();
    const stalePrompt = staleIds.has(sess.id);
    const dispatch = (force: boolean) => {
      void analyseOnce(sess.id, sess.title ?? sess.id.slice(0, 12), sess.location?.directory, stt.status, wait, force);
    };

    // La suppression du compagnon est indépendante de l'activité du parent :
    // réparer immédiatement même si la tâche est idle et n'a reçu aucun message.
    if (missingIds.has(sess.id)) { dispatch(true); continue; }

    // Un kick de début ou de fin de tour est un signal réel : il ne doit pas
    // être perdu parce qu'une analyse de cadrage vient d'avoir lieu. Le
    // dédoublonnage par digest dans analyseOnce évite les appels à vide.
    const k = takeKick(sess.id);
    const due = Date.now() - (s.lastRunAt ?? 0) >= MIN_INTERVAL_MS;
    if (!due && !(k?.start || k?.end)) continue;
    // migration de prompt : une passe par session, espacée, même sans nouveau message
    if (stalePrompt) {
      if (Date.now() - (s.lastMigrationAt ?? 0) >= 60_000) {
        s.lastMigrationAt = Date.now();
        dispatch(true);
        continue;
      }
      // migration déjà tentée récemment : un kick réel reste prioritaire
      if (k?.start) { dispatch(true); continue; }
      if (k?.end) { dispatch(false); continue; }
      continue;
    }

    if (k?.start) { dispatch(true); continue; }  // prompt reçu → cadrage immédiat
    if (k?.end) { dispatch(false); continue; }   // tour fini → analyse de clôture
    const busyPeriodic = stt.status === 'busy' && Date.now() - (s.lastRunAt ?? 0) >= PERIOD_MS;
    if (busyPeriodic) { dispatch(false); continue; }
    // session idle immobile : le compagnon ne fait RIEN (anti-relance)
  }
}

export function verdictOf(sid: string) { return getVerdict(sid); }
export function companionSessionOf(sid: string) { return get(sid).compSession ?? null; }
