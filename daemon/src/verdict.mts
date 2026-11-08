/**
 * Contrat du verdict du compagnon.
 *
 * Tout ce qui décide de la qualité d'une carte est ici, en fonctions pures :
 * - le parsing tolérant (anciennes clés françaises, réponses bruitées) ;
 * - la normalisation stricte (état, plan, progression calculée, attente gatée) ;
 * - le linter des textes affichés (voix, jargon, télémétrie, identifiants) ;
 * - la détection déterministe d'une question réellement adressée au propriétaire.
 *
 * Le LLM propose, le daemon dispose : la progression vient du plan, l'attente
 * vient des formulaires/permissions/question réelle, `done` implique 100.
 */

export type VerdictState = 'working' | 'waiting_human' | 'done' | 'blocked';
export type HumanSource = 'question_tool' | 'permission' | 'agent_ask' | 'none';

export interface PlanStep {
  step: string;
  done: boolean;
}

export interface WaitInfo {
  waiting: boolean;
  source: HumanSource;
  ask: string;
}

export interface RawVerdict {
  state?: unknown;
  summary?: unknown;
  resume?: unknown;
  next?: unknown;
  plan?: unknown;
  progress?: unknown;
  human_request?: unknown;
  pending_human?: unknown;
  attend?: unknown;
  wait?: unknown;
  done?: unknown;
  termine?: unknown;
  [key: string]: unknown;
}

export interface PreviousVerdict {
  resume?: string | null;
  progress?: number | null;
  termine?: number | boolean | null;
  state?: string | null;
  plan?: PlanStep[];
  attend?: string | null;
}

export interface NormalizeContext {
  busy: boolean;
  wait: WaitInfo;
  agentAsk?: string | null;
  objectiveChanged: boolean;
  objective: string;
  /** Plan de la session de travail (`planwrite`) : seule source de progression. */
  workPlan?: PlanStep[];
  previous?: PreviousVerdict | null;
}

export interface NormalizedVerdict {
  state: VerdictState;
  summary: string;
  next: string;
  plan: PlanStep[];
  progress: number | null;
  attend: string;
  humanSource: HumanSource;
  done: boolean;
  lintReasons: string[];
}

export interface ObjectiveState {
  objective?: string | null;
  objective_version?: number | null;
  last_user_id?: string | null;
  goal?: string | null;
  plan?: string | null;
}

export interface ObjectiveInput {
  prev?: ObjectiveState | null;
  lastUser?: { id: string; text: string } | null;
  firstUser?: string | null;
}

export interface ObjectiveResult {
  objective: string;
  version: number;
  lastUserId?: string;
  changed: boolean;
  plan: PlanStep[];
  goal: string;
}

const EMPTY_WAIT: WaitInfo = { waiting: false, source: 'none', ask: '' };

export function emptyWait(): WaitInfo {
  return { ...EMPTY_WAIT };
}

function pickString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

function normalizeState(v: unknown): VerdictState | undefined {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'working' || s === 'en_cours' || s === 'encours' || s === 'en cours') return 'working';
  if (s === 'waiting_human' || s === 'waiting' || s === 'attente' || s === 'attend') return 'waiting_human';
  if (s === 'done' || s === 'termine' || s === 'terminé' || s === 'fini') return 'done';
  if (s === 'blocked' || s === 'bloque' || s === 'bloqué') return 'blocked';
  return undefined;
}

/** Parse le premier objet JSON d'une réponse, sans exiger le schéma complet. */
export function parseVerdictText(text: string): RawVerdict | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as RawVerdict;
  } catch {
    return null;
  }
}

/** Normalise un plan (tableau, objet {steps}, ou chaîne JSON). 6 étapes maximum. */
export function normalizePlan(raw: unknown): PlanStep[] {
  let source = raw;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { return []; }
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const obj = source as Record<string, unknown>;
    source = obj.steps ?? obj.plan ?? obj.etapes ?? obj['étapes'];
  }
  if (!Array.isArray(source)) return [];
  const out: PlanStep[] = [];
  for (const item of source.slice(0, 6)) {
    if (typeof item === 'string') {
      const s = item.trim();
      if (s) out.push({ step: s.slice(0, 120), done: false });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = pickString(obj.step, obj.label, obj.title, obj.etape, obj['étape']);
    if (!label) continue;
    out.push({
      step: label.slice(0, 120),
      done: obj.done === true || obj.termine === true || obj['terminé'] === true || obj.complete === true,
    });
  }
  return out;
}

export function parsePlanFromDb(raw: unknown): PlanStep[] {
  if (!raw) return [];
  return normalizePlan(raw);
}

/** Progression = étapes faites / étapes. 100 seulement si l'objectif est done. */
export function planProgress(plan: PlanStep[], done: boolean): number | null {
  if (done) return 100;
  if (!plan.length) return null;
  const n = plan.filter(s => s.done).length;
  return Math.min(99, Math.round((n / plan.length) * 100));
}

/**
 * Détecte une question réellement adressée au propriétaire dans le dernier
 * message de l'agent. Volontairement conservateur : sans marqueur explicite,
 * une longue explication contenant un « ? » n'est pas une attente humaine.
 */
export function detectHumanQuestion(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim();
  if (!t || !t.includes('?')) return null;
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? t;
  if (last.length > 320) return null;
  const q = (last.match(/[^.!?]*\?/)?.[0] ?? last).trim();
  if (!q || q.length > 220) return null;
  const markers = /(veux-tu|souhaites-tu|pr[ée]f[èe]res-tu|peux-tu|dis-moi|confirme|dois-je|on part sur|tu veux|tu pr[ée]f[èe]res|as-tu|est-ce que tu|que veux-tu|quelle option|tu choisis|tu valides|tu confirmes|tu peux)/i;
  if (markers.test(q)) return q.slice(0, 180);
  // question courte en fin de message : probablement adressée au lecteur
  if (t.length <= 220 && /\?$/.test(q)) return q.slice(0, 180);
  return null;
}

/**
 * Un message humain qui reprend/decrit une nouvelle demande (verbe d'action),
 * par opposition à une réponse courte (« oui », « Bun », « Les deux »).
 */
export function isNewObjective(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (t.length < 40) return false;
  return /\b(fais|faire|ajoute|impl[ée]mente|corrige|cr[ée]e|[ée]cris|modifie|d[ée]marre|lance|supprime|refais|change|mets|garde|v[ée]rifie|analyse|explique|continue|remplace|renomme|d[ée]place|installe|build|commit|push|teste|reprends|poursuis)\b/i.test(t);
}

/** Résout l'objectif courant et la version (reset du plan seulement sur nouvel objectif). */
export function resolveObjective(input: ObjectiveInput): ObjectiveResult {
  const prev = input.prev ?? undefined;
  const first = (input.firstUser ?? '').trim();
  const goal = (prev?.goal ?? first ?? '').trim();
  let objective = (prev?.objective ?? goal ?? '').trim();
  let version = Number(prev?.objective_version ?? 1);
  if (!Number.isFinite(version) || version < 1) version = 1;
  let plan = parsePlanFromDb(prev?.plan);
  let lastUserId = prev?.last_user_id ?? undefined;
  let changed = false;

  const last = input.lastUser;
  if (last && last.id !== prev?.last_user_id) {
    const text = last.text.trim();
    if (!prev?.objective) {
      if (text) { objective = text; version = 1; }
    } else if (text && isNewObjective(text) && text !== objective) {
      objective = text;
      version += 1;
      plan = [];
      changed = true;
    }
    lastUserId = last.id;
  }
  if (!objective && last?.text) objective = last.text.trim();
  return { objective, version, lastUserId, changed, plan, goal: goal || objective };
}

/** Nettoie les marqueurs interdits sans casser la phrase (les IDs partent, le reste reste). */
export function scrubSummary(text: string): string {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\bses_[A-Za-z0-9]+\b/g, '')
    .replace(/\bmsg_[A-Za-z0-9]+\b/g, '')
    .replace(/\bchatcmpl-[A-Za-z0-9_-]+\b/g, '')
    .replace(/\bcommit\s+[0-9a-f]{6,40}\b/gi, 'la modification')
    .replace(/l['’]humain/gi, 'tu')
    .replace(/l['’]utilisateur/gi, 'tu')
    .replace(/\ble compagnon\b/gi, "l'agent")
    .replace(/\s+/g, ' ')
    .trim();
}

function looksEnglish(t: string): boolean {
  if (t.length < 40) return false;
  const fr = (t.match(/\b(le|la|les|des|une|un|est|et|pour|dans|avec|sur|pas|qui|que|tu|je|il|elle|nous|vous|au|aux|du|de)\b/gi) ?? []).length;
  const en = (t.match(/\b(the|this|that|with|from|is|are|was|were|has|have|not|and|for|you|your|session|turn|objective)\b/gi) ?? []).length;
  return en >= 2 && en > fr;
}

export interface LintResult {
  ok: boolean;
  reasons: string[];
  cleaned: string;
}

/** Linter des textes de carte : voix, jargon, télémétrie, identifiants, langue. */
export function lintSummary(text: string): LintResult {
  const raw = String(text ?? '');
  const cleaned = scrubSummary(raw);
  const reasons: string[] = [];
  if (!cleaned) reasons.push('résumé vide');
  if (/\b(?:ses_|msg_|chatcmpl-)/i.test(raw) || raw.includes('`')) reasons.push('identifiant ou code');
  if (/\bcommit\s+[0-9a-f]{6,}/i.test(raw)) reasons.push('commit');
  if (/\b(?:idle|busy|extrait|aucun changement|rien de nouveau|session au repos|session en cours)\b/i.test(raw)) reasons.push('télémétrie');
  if (/l['’]humain|l['’]utilisateur|\bthe user\b/i.test(raw)) reasons.push('mot interdit');
  if (/\ble compagnon\b/i.test(raw)) reasons.push("compagnon pour l'agent");
  if (/\b(plan de \d+ à \d+ étapes|plan actuel|plan non établi|aucun plan|contrat|json|verdict|digest|l['’]analyste)\b/i.test(raw)) reasons.push('mécanique interne');
  if (/\b(taux d['’]avancement|pourcentage affich|liste de tâches est vide)\b/i.test(raw)) reasons.push('mécanique interne');
  if (/\b(doc(?:ument)? \d+|README|section [A-Z]\b|branche\b|commit\b|\d+\s*\/\s*\d+\s+tests?|\d+\s*%)\b/i.test(raw)) reasons.push('jargon');
  if (looksEnglish(cleaned)) reasons.push('pas en français');
  if (cleaned.length > 320) reasons.push('trop long');
  return { ok: reasons.length === 0, reasons, cleaned };
}

/** Seules les violations de fond justifient une reprise LLM ; le reste est nettoyé. */
export function shouldRepair(reasons: string[]): boolean {
  return reasons.some(r =>
    r === 'résumé vide'
    || r === 'télémétrie'
    || r === 'mot interdit'
    || r === 'mécanique interne'
    || r === 'jargon'
    || r === 'pas en français'
    || r === "compagnon pour l'agent",
  );
}

/** Une ligne d'action d'outil, courte et factuelle, pour le digest. */
export function toolActionLine(part: unknown): string | null {
  const p = part as {
    type?: string; name?: string; tool?: string;
    state?: { status?: string; input?: Record<string, unknown> };
  } | null;
  if (!p || p.type !== 'tool') return null;
  const name = String(p.name ?? p.tool ?? '').trim();
  if (!name) return null;
  const input = p.state?.input ?? {};
  const target = input.path ?? input.filePath ?? input.command ?? input.pattern ?? input.description ?? input.title ?? input.query ?? '';
  const clean = String(target).replace(/\s+/g, ' ').trim().slice(0, 160);
  const status = p.state?.status ? ` (${p.state.status})` : '';
  return `[OUTIL ${name}] ${clean}${status}`;
}

/** Normalisation finale : c'est ici que les règles dures sont appliquées. */
export function normalizeVerdict(raw: RawVerdict, ctx: NormalizeContext): NormalizedVerdict {
  const rawState = normalizeState(raw.state);
  let done = raw.done === true || raw.termine === true || raw.termine === 1 || rawState === 'done';
  if (ctx.busy) done = false;

  const waiting = ctx.wait.waiting || (!!ctx.agentAsk && !ctx.busy);
  const humanSource: HumanSource = waiting
    ? (ctx.wait.waiting ? ctx.wait.source : 'agent_ask')
    : 'none';

  let state: VerdictState;
  if (done) state = 'done';
  else if (waiting) state = 'waiting_human';
  else if (rawState === 'blocked' && !ctx.busy) state = 'blocked';
  else state = 'working';

  const hr = raw.human_request;
  const hrAsk = hr && typeof hr === 'object' && !Array.isArray(hr) ? (hr as Record<string, unknown>).ask : hr;
  const ask = pickString(hrAsk, raw.pending_human, raw.attend, raw.wait, ctx.wait.ask, ctx.agentAsk);
  const attend = waiting ? ask.slice(0, 180) : '';

  // La progression ne vient jamais du texte du compagnon : uniquement du
  // `planwrite` de la session de travail. Un plan vide signifie pas de barre.
  const plan = (ctx.workPlan ?? []).map(s => ({ ...s }));
  let progress: number | null = plan.length ? planProgress(plan, done) : (done ? 100 : null);
  if (!done && plan.length && progress != null && ctx.previous?.progress != null) {
    const samePlan = JSON.stringify(plan) === JSON.stringify(ctx.previous.plan ?? []);
    if (samePlan && progress < ctx.previous.progress - 5) progress = ctx.previous.progress;
  }

  const rawSummary = pickString(raw.summary, raw.resume);
  const lint = lintSummary(rawSummary);
  let summary = lint.cleaned;
  if (!summary) {
    const prev = String(ctx.previous?.resume ?? '').trim();
    summary = prev || `L'agent travaille sur : ${ctx.objective.slice(0, 140)}`;
  }

  return {
    state,
    summary: summary.slice(0, 300),
    next: scrubSummary(pickString(raw.next)).slice(0, 200),
    plan,
    progress: done ? 100 : progress,
    attend,
    humanSource,
    done,
    lintReasons: lint.reasons,
  };
}
