/**
 * Auto-restart de tâche : quand la session OpenCode derrière une carte disparaît
 * (crash, suppression manuelle dans OpenChamber), une nouvelle session repart
 * automatiquement pour cette tâche, sur le modèle default courant, et reprend
 * la carte sans dupliquer l'historique.
 *
 * Le registre vit dans `task_resume` (state.mts) : `task_id` = identité stable
 * de la tâche (l'id de la session d'origine), `session_id` = session vivante
 * actuelle. Les garde-fous : confirmation de disparition, budget de tentatives,
 * backoff croissant, désactivation définitive après échecs répétés.
 *
 * Un archivage n'est PAS une destruction : c'est un geste humain dans
 * OpenChamber, on désactive la reprise au lieu de ressusciter la conversation.
 */

import {
  armTaskResume, db, disableTaskResume, getTaskBrief, getTaskResume, getTaskResumeBySession,
  getTaskState, listTaskResume, listTaskBriefs, logEvent, migrateTaskSession,
  noteResumeAlive, noteResumeAttempt, resetResumeAttempts,
} from './state.mts';
import { defaultModelRef, findModel } from './models.mts';
import { getPlanSnapshot, planStepsOf } from './plan.mts';

let base = '';
export function setBase(b: string) { base = b.replace(/\/$/, ''); }

export interface ResumeConfig {
  enabled: boolean;
  /** tentatives consécutives avant désactivation de la tâche */
  maxAttempts: number;
  /** backoff de base, doublé à chaque essai */
  backoffBaseMs: number;
  /** une session vivante depuis ce délai remet le budget à zéro */
  resetAfterMs: number;
  /** une session absente depuis ce délai ET confirmée 404 est réellement détruite */
  confirmMissingMs: number;
  /** au premier balayage : une tâche déjà orpheline n'est reprise que si son activité date de moins de ça */
  legacyWindowMs: number;
}

export const DEFAULT_CONFIG: ResumeConfig = {
  enabled: true,
  maxAttempts: 3,
  backoffBaseMs: 30_000,
  resetAfterMs: 10 * 60_000,
  confirmMissingMs: 10_000,
  legacyWindowMs: 48 * 60 * 60_000,
};

export function resumeConfigFromEnv(env: Record<string, string | undefined> = process.env): ResumeConfig {
  const flag = String(env.SUPERVISEUR_AUTO_RESTART ?? '1').trim().toLowerCase();
  const enabled = !['0', 'false', 'off', 'non'].includes(flag);
  const num = (key: string, fallback: number): number => {
    const raw = Number(env[key]);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  };
  return {
    enabled,
    maxAttempts: num('SUPERVISEUR_AUTO_RESTART_MAX', DEFAULT_CONFIG.maxAttempts),
    backoffBaseMs: num('SUPERVISEUR_AUTO_RESTART_BACKOFF_MS', DEFAULT_CONFIG.backoffBaseMs),
    resetAfterMs: num('SUPERVISEUR_AUTO_RESTART_RESET_MS', DEFAULT_CONFIG.resetAfterMs),
    confirmMissingMs: num('SUPERVISEUR_AUTO_RESTART_CONFIRM_MS', DEFAULT_CONFIG.confirmMissingMs),
    legacyWindowMs: num('SUPERVISEUR_AUTO_RESTART_LEGACY_MS', DEFAULT_CONFIG.legacyWindowMs),
  };
}

/** Backoff croissant : 30 s, 60 s, 120 s... plafonné à 10 min. */
export function nextBackoffMs(attempts: number, cfg: ResumeConfig): number {
  return Math.min(cfg.backoffBaseMs * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

/**
 * Garde-fous purs, testables. `cfg2` = ce que l'appelant a déjà établi
 * (session confirmée absente, instance vivante), `verdict` = dernier bilan connu.
 */
export interface RestartVerdict {
  restart: boolean;
  reason?: 'ok' | 'disabled' | 'exhausted' | 'backoff' | 'closed' | 'recent_attempt' | 'not_confirmed' | 'no_model';
  waitMs?: number;
}

export function shouldRestartTask(p: {
  attempts: number;
  lastAttemptAt: number | null;
  now: number;
  confirmedMissing: boolean;
  closed: boolean;
  disabled: boolean;
  modelResolved: boolean;
  cfg: ResumeConfig;
}): RestartVerdict {
  const { cfg, now } = p;
  if (p.disabled) return { restart: false, reason: 'disabled' };
  if (p.closed) return { restart: false, reason: 'closed' };
  if (p.attempts >= cfg.maxAttempts) return { restart: false, reason: 'exhausted' };
  if (!p.confirmedMissing) return { restart: false, reason: 'not_confirmed' };
  if (!p.modelResolved) return { restart: false, reason: 'no_model' };
  const last = p.lastAttemptAt ?? 0;
  const wait = nextBackoffMs(Math.max(1, p.attempts + 1), cfg);
  if (last && now - last < wait) return { restart: false, reason: 'backoff', waitMs: wait - (now - last) };
  return { restart: true, reason: 'ok' };
}

/** Prompt de reprise : le brief de la tâche, plus l'état connu au moment de la perte. */
export function composeResumePrompt(p: {
  goal: string;
  doneCriteria: string[];
  constraints: string[];
  project: string;
  plan?: Array<{ step?: string; done?: boolean }>;
  summary?: string;
  next?: string;
  progressDone?: number;
}): string {
  const lines = [
    `Objectif : ${p.goal}`,
    '',
    'Critères de réussite :',
    ...(p.doneCriteria.length ? p.doneCriteria.map(c => `- ${c}`) : ['- L’objectif est atteint et vérifié.']),
    '',
    'Contraintes :',
    ...(p.constraints.length ? p.constraints.map(c => `- ${c}`) : ['- Aucune contrainte supplémentaire.']),
    '',
    'Contexte :',
    `Reprise automatique : la session précédente de cette tâche (${p.project}) a été détruite (crash ou suppression manuelle). Tu démarres dans une session neuve, sur le modèle default courant : continue le travail là où il en était, ne repars pas du début et ne refais pas ce qui est déjà livré.`,
  ];
  if (p.summary) lines.push(`Dernier bilan connu : ${p.summary}`);
  if (p.progressDone != null) lines.push(`Étapes déjà terminées : ${p.progressDone}`);
  if (p.plan?.length) {
    lines.push('', 'Plan connu (rétablis-le avec `planwrite` avant de continuer) :');
    for (const step of p.plan) lines.push(`- ${step.done ? '(fait) ' : '(à refaire si besoin) '}${step.step ?? ''}`.trim());
  }
  if (p.next) lines.push('', `Prochaine étape suggérée : ${p.next}`);
  lines.push(
    '',
    'Plan : utilise `planwrite` pour poser un plan de 3 à 6 étapes. Remplace la liste complète à chaque changement, marque `in_progress` quand tu commences une étape et `completed` quand elle est finie. Utilise `planread` après une compaction.',
    'Bilan : à la fin, écris un court bilan (fait, reste, décisions) dans ton dernier message.',
  );
  return lines.join('\n');
}

/* --- client HTTP (OpenChamber proxy, sans auth : comme le reste du daemon) --- */

async function jget(path: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function jpost(path: string, body: unknown, timeoutMs = 20000): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(t); }
}

/** Session réellement détruite ou archivée, par lecture directe (hors pagination). */
export async function sessionGone(id: string): Promise<'gone' | 'alive' | 'archived' | 'unknown'> {
  try {
    const body = await jget(`/api/session/${encodeURIComponent(id)}`) as {
      data?: { id?: string; time?: { archived?: number } };
    };
    const s = body?.data;
    // une session qui n'arrive même pas à se décrire : on ne décide rien
    if (!s?.id && !s?.time) return 'unknown';
    return s.time?.archived ? 'archived' : 'alive';
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/→ 404/.test(msg)) return 'gone';
    return 'unknown'; // instance injoignable : ne rien décider
  }
}

/* --- registre : armement initial des tâches existantes --- */

let backfilled = false;

/**
 * Arme les tâches connues qui ont besoin d'un registre. Appelé une fois, au
 * premier balayage d'instance vivante : les orphelines de longue date sont
 * désactivées (activité trop ancienne), les récentes restent candidates.
 */
export function backfillResumeTasks(liveIds: Set<string>, cfg: ResumeConfig, now = Date.now()): { armed: number; disabled: number } {
  let armed = 0, disabled = 0;
  for (const brief of listTaskBriefs()) {
    // lignage : un brief peut déjà être porté par une ligne de registre créée
    // sous l'id de la session d'origine (après une reprise), pas un doublon
    if (getTaskResume(brief.session_id) || getTaskResumeBySession(brief.session_id)) continue;
    const st = getTaskState(brief.session_id) as { closed_at?: number } | null;
    if (st?.closed_at) continue;
    const live = liveIds.has(brief.session_id);
    const lastKnown = lastKnownActivityAt(brief.session_id, brief.created_at);
    if (live || now - lastKnown < cfg.legacyWindowMs) {
      armTaskResume(brief.session_id, {
        sessionId: brief.session_id,
        title: brief.title ?? 'tâche',
        projectDir: brief.project_dir ?? '',
        agent: brief.agent,
        model: brief.model,
      });
      armed++;
    } else {
      // une ligne existe même désactivée : le balayage voit l'état, pas un trou
      armTaskResume(brief.session_id, {
        sessionId: brief.session_id,
        title: brief.title ?? 'tâche',
        projectDir: brief.project_dir ?? '',
        agent: brief.agent,
        model: brief.model,
      });
      disableTaskResume(brief.session_id, 'orpheline de longue date (avant le registre)');
      disabled++;
    }
  }
  return { armed, disabled };
}

function lastKnownActivityAt(sessionId: string, fallback: number): number {
  const rows = db.query('SELECT MAX(at) m FROM task_log WHERE session_id = ?').all(sessionId) as Array<{ m?: number }>;
  let max = fallback;
  for (const r of rows) {
    const v = r?.m ?? 0;
    if (v > max) max = v;
  }
  return max;
}

/* --- observation : une session vivante met à jour le suivi --- */

function noteAlive(row: NonNullable<ReturnType<typeof getTaskResume>>, now: number, cfg: ResumeConfig) {
  noteResumeAlive(row.task_id, now);
  const since = row.session_since ?? now;
  if (row.attempts > 0 && now - since >= cfg.resetAfterMs) {
    resetResumeAttempts(row.task_id, now);
    logEvent(row.task_id, 'note', `reprise : budget remis à zéro après ${Math.round((now - since) / 60000)} min de session stable`);
  }
}

/* --- boucle de balayage --- */

const missingSince = new Map<string, number>();
let ticking = false;

export interface ResumeTickStats { disabled: number; restarted: Array<{ task: string; from: string; to: string }> }

export async function resumeTick(liveIds: Set<string>, cfg = resumeConfigFromEnv()): Promise<ResumeTickStats> {
  const stats: ResumeTickStats = { disabled: 0, restarted: [] };
  if (!cfg.enabled || !liveIds.size) return stats;
  if (!backfilled) {
    const { armed, disabled } = backfillResumeTasks(liveIds, cfg);
    backfilled = true;
    if (armed || disabled) console.log(`[resume] registre initial : ${armed} armée(s), ${disabled} désactivée(s)`);
  }
  if (ticking) return stats;
  ticking = true;
  try {
    const now = Date.now();
    for (const row of listTaskResume()) {
      if (liveIds.has(row.session_id)) {
        missingSince.delete(row.task_id);
        noteAlive(row, now, cfg);
        continue;
      }
      if (row.disabled_at) continue;
      const st = getTaskState(row.session_id) as { closed_at?: number } | null;
      if (st?.closed_at) {
        disableTaskResume(row.task_id, 'tâche fermée dans le Superviseur', now);
        stats.disabled++;
        continue;
      }
      // confirmation : absente de deux balayages ET 404/archivée en lecture directe
      const missingAt = missingSince.get(row.task_id) ?? now;
      missingSince.set(row.task_id, missingAt);
      const confirmed = now - missingAt >= cfg.confirmMissingMs;
      const status = confirmed ? await sessionGone(row.session_id) : 'unknown';
      if (status === 'alive') { missingSince.delete(row.task_id); noteAlive(row, now, cfg); continue; }
      if (status === 'unknown') continue;
      if (status === 'archived') {
        disableTaskResume(row.task_id, 'session archivée dans OpenChamber', now);
        stats.disabled++;
        continue;
      }
      // destruction confirmée
      const verdict = shouldRestartTask({
        attempts: row.attempts,
        lastAttemptAt: row.last_attempt_at,
        now,
        confirmedMissing: true,
        closed: !!st?.closed_at,
        disabled: false,
        modelResolved: true, // résolu en deux temps : la reprise seule décide
        cfg,
      });
      if (!verdict.restart) {
        if (verdict.reason === 'exhausted') {
          disableTaskResume(row.task_id, `budget de reprise épuisé (${row.attempts} essais)`, now);
          stats.disabled++;
        }
        continue;
      }
      // Le modèle de la tâche prime : le réglage global ne sert qu'aux
      // nouvelles tâches. Sans modèle propre, la reprise suit le défaut.
      const storedModel = getTaskBrief(row.session_id)?.model ?? row.model ?? null;
      const storedValid = storedModel ? await findModel(storedModel) : null;
      if (storedModel && !storedValid) {
        logEvent(row.task_id, 'note',
          `reprise : modèle de la tâche « ${storedModel} » introuvable, repli sur le défaut`);
      }
      const model = storedValid?.ref ?? await defaultModelRef();
      if (!model) {
        // pas de modèle joignable : pas de départ en aveugle, l'essai est consommé
        noteResumeAttempt(row.task_id, { at: now });
        logEvent(row.task_id, 'note', 'reprise reportée : modèle de la tâche et défaut introuvables');
        missingSince.delete(row.task_id);
        continue;
      }
      const result = await restartTask(row, model!, now);
      if (result.ok && result.newId) stats.restarted.push({ task: row.task_id, from: row.session_id, to: result.newId });
      missingSince.delete(row.task_id);
    }
  } finally {
    ticking = false;
  }
  return stats;
}

/** Crée la session de reprise et migre les données locales de la tâche. */
async function restartTask(row: NonNullable<ReturnType<typeof getTaskResume>>, model: string, now: number): Promise<{ ok: boolean; newId?: string }> {
  const brief = getTaskBrief(row.session_id);
  const st = getTaskState(row.session_id) as {
    objective?: string; plan?: string; closed_at?: number;
  } | null;
  if (st?.closed_at) {
    disableTaskResume(row.task_id, 'tâche fermée dans le Superviseur', now);
    return { ok: false };
  }
  const title = brief?.title ?? row.title ?? 'tâche reprise';
  // l'objectif courant prime sur le brief initial : une tâche évolue, le
  // dernier objectif versionné est plus fidèle au travail en cours
  const goal = st?.objective || brief?.goal || 'Reprendre la tâche';
  const parseList = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  };
  // le plan est relu du tool part `planwrite` de la session perdue (le plan
  // n'est plus stocké en base depuis le retrait du compagnon)
  const snap = await getPlanSnapshot(row.session_id);
  const plan = planStepsOf(snap).map(s => ({ step: s.step, done: s.done }));
  const prompt = composeResumePrompt({
    goal,
    doneCriteria: parseList(brief?.done_criteria),
    constraints: parseList(brief?.constraints),
    project: brief?.project_dir ?? row.project_dir ?? '',
    plan,
    summary: lastSummaryOf(row.session_id),
    progressDone: plan.filter(p => p.done).length,
  });
  const agent = brief?.agent ?? row.agent ?? 'build';
  const out = await jpost('/api/openchamber/sessions', {
    title,
    prompt,
    directory: brief?.project_dir ?? row.project_dir ?? '',
    agent,
    model,
  });
  const newId = (out.data as { sessionId?: string })?.sessionId;
  if (!out.ok || !newId) {
    // échec de création : compté comme une tentative, le backoff évite la boucle
    noteResumeAttempt(row.task_id, { at: now });
    logEvent(row.task_id, 'note', `reprise impossible : création refusée (${out.status})`);
    console.warn(`[resume] création refusée pour ${row.task_id} (${out.status})`);
    return { ok: false };
  }
  migrateTaskSession(row.session_id, newId);
  noteResumeAttempt(row.task_id, { newSessionId: newId, at: now });
  logEvent(newId, 'repart', `reprise automatique de ${title} (session précédente détruite)`.slice(0, 180));
  logEvent('supervisor', 'note', `reprise auto : ${title} → ${newId.slice(-6)} (modèle ${model})`);
  console.log(`[resume] ${title} : ${row.session_id} détruite → nouvelle session ${newId} (${model})`);
  return { ok: true, newId };
}

function lastSummaryOf(sessionId: string): string | undefined {
  // plus de verdict (compagnon retiré) : le dernier bilan connu est la
  // dernière réponse de la tâche au propriétaire (tool answer)
  const v = db.query('SELECT text FROM task_answer WHERE session_id = ? ORDER BY at DESC, id DESC LIMIT 1')
    .get(sessionId) as { text?: string } | undefined;
  const text = String(v?.text ?? '').trim();
  return text ? text.slice(0, 600) : undefined;
}

/** Pour les tests : réinitialise l'état du module (registre déjà rempli, confirmations). */
export function resetResumeState() {
  backfilled = false;
  missingSince.clear();
  ticking = false;
}
