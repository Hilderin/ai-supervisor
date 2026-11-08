/**
 * Critères d'acceptation : machine à états et accès DB (table `criteria`).
 *
 * Source unique des transitions : les tools criteria de l'agent principal ET
 * l'application du JSON du vérificateur passent tous par ces fonctions ; le
 * statut d'un critère n'est jamais écrit directement ailleurs.
 *
 * États : todo (À faire), to_validate (À valider, preuve soumise),
 * to_fix (À corriger, rejet avec justification), validated (Validé).
 *
 * Transitions (spec : docs/analyses/mvp1/criteres-acceptation.md §2) :
 * - add → todo ; to_validate : todo|to_fix → to_validate (preuve requise) ;
 * - approve (daemon seul) : to_validate → validated ;
 * - reject (daemon seul) : to_validate → to_fix (raison requise) ;
 * - update de contenu : un critère non todo repasse todo (preuve invalidée) ;
 * - remove : ligne supprimée, ref jamais réattribuée (criteria_seq).
 *
 * Preuves : `path` est vérifié au dépôt (fichier existant dans le dossier du
 * projet, chemin relatif sans sortie ni lien symbolique) : une preuve à
 * chemin inexistant est refusée au tool, pas au vérificateur.
 */
import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { db, logEvent } from './state.mts';

export type CriterionStatus = 'todo' | 'to_validate' | 'to_fix' | 'validated';

export const METHODS = [
  'unit_test', 'e2e', 'browser_nav', 'screenshot', 'human', 'text',
  'code_excerpt', 'artifact', 'command', 'diff', 'doc',
] as const;
export type EvidenceKind = (typeof METHODS)[number];

const METHOD_SET = new Set<string>(METHODS);
export const MAX_CRITERIA = 12;
const MAX_TITLE = 200;
const MAX_DETAIL = 2000;
const MAX_EVIDENCE = 8;
const MAX_REF_DIGITS = 99;

export interface EvidenceItem {
  kind: EvidenceKind;
  text: string;
  path?: string;
  start_line?: number;
  line_count?: number;
  at: number;
}

export interface CriterionRow {
  id: number;
  task_id: string;
  ref: string;
  title: string;
  detail: string | null;
  methods: string[];
  status: CriterionStatus;
  evidence: EvidenceItem[];
  review: string | null;
  review_at: number | null;
  created_at: number;
  updated_at: number;
  /** version du contenu jugé (preuve ou contenu) : l'approbation vise une version précise */
  version: number;
  validated_at: number | null;
  /** proposition de retrait du vérificateur (jamais une suppression physique) */
  remove_proposed_at: number | null;
  remove_reason: string | null;
  removed_at: number | null;
}

export class CriteriaError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* --- Validation des entrées --- */

export function parseMethods(raw: unknown, { required = true } = {}): string[] | undefined {
  if (raw == null) {
    if (required) throw new CriteriaError('invalid_method', 'au moins une méthode de validation est requise');
    return undefined;
  }
  if (!Array.isArray(raw)) throw new CriteriaError('invalid_method', 'methods doit être un tableau');
  const out: string[] = [];
  for (const m of raw) {
    const v = String(m ?? '').trim().toLowerCase();
    if (!METHOD_SET.has(v)) {
      throw new CriteriaError('invalid_method', `méthode inconnue : ${v || '(vide)'} ; permises : ${METHODS.join(', ')}`);
    }
    if (!out.includes(v)) out.push(v);
  }
  if (required && out.length === 0) {
    throw new CriteriaError('invalid_method', 'au moins une méthode de validation est requise');
  }
  return out;
}

/** Types de preuve qui exigent un chemin de fichier. */
const PATH_KINDS = new Set(['screenshot', 'code_excerpt', 'artifact']);

function validateEvidenceItem(item: unknown): EvidenceItem {
  if (!item || typeof item !== 'object') throw new CriteriaError('invalid_evidence', 'chaque preuve doit être un objet');
  const obj = item as Record<string, unknown>;
  const kind = String(obj.kind ?? '').trim().toLowerCase();
  if (!METHOD_SET.has(kind)) {
    throw new CriteriaError('invalid_evidence', `type de preuve inconnu : ${kind || '(vide)'}`);
  }
  const text = String(obj.text ?? '').trim();
  if (!text) throw new CriteriaError('invalid_evidence', 'chaque preuve exige un texte (ce qui prouve le critère)');
  const out: EvidenceItem = { kind: kind as EvidenceKind, text: text.slice(0, 2000), at: Date.now() };
  const path = String(obj.path ?? '').trim();
  if (path) out.path = path;
  if (kind === 'code_excerpt') {
    const startLine = Math.floor(Number(obj.start_line));
    const lineCount = Math.floor(Number(obj.line_count));
    if (!path || !Number.isFinite(startLine) || startLine < 1 || !Number.isFinite(lineCount) || lineCount < 1) {
      throw new CriteriaError('invalid_evidence', 'code_excerpt exige path, start_line et line_count');
    }
    out.start_line = startLine;
    out.line_count = lineCount;
  } else if (PATH_KINDS.has(kind) && !path) {
    throw new CriteriaError('invalid_evidence', `le type ${kind} exige un path`);
  }
  if (!PATH_KINDS.has(kind) && out.path) delete out.path;
  return out;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Vérifie qu'un chemin de preuve est un fichier existant du projet (relatif, sans sortie). */
export async function validateEvidencePath(projectDir: string, rawPath: string): Promise<string> {
  const value = String(rawPath ?? '').trim();
  if (!value) throw new CriteriaError('invalid_evidence', 'chemin de preuve requis');
  if (value.length > 1024 || value.includes('\0') || isAbsolute(value)) {
    throw new CriteriaError('invalid_evidence', 'chemin relatif requis pour la preuve');
  }
  const parts = value.split(/[\\/]+/).filter(p => p && p !== '.');
  if (parts.some(p => p === '..')) throw new CriteriaError('invalid_evidence', 'sortie du projet interdite');
  let root: string;
  try { root = await realpath(projectDir); } catch {
    throw new CriteriaError('invalid_evidence', 'dossier du projet indisponible');
  }
  let cursor = root;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    let info;
    try { info = await lstat(cursor); } catch {
      throw new CriteriaError('evidence_path_missing', `fichier de preuve introuvable : ${parts.join('/')}`);
    }
    if (info.isSymbolicLink()) throw new CriteriaError('invalid_evidence', 'lien symbolique interdit dans une preuve');
  }
  if (!inside(root, cursor)) throw new CriteriaError('invalid_evidence', 'chemin hors projet');
  const st = await stat(cursor);
  if (!st.isFile()) throw new CriteriaError('invalid_evidence', 'un fichier est requis pour la preuve');
  return parts.join('/');
}

/* --- Accès DB --- */

interface RawCriterion {
  id: number; task_id: string; ref: string; title: string;
  detail: string | null; methods: string; status: string; evidence: string | null;
  review: string | null; review_at: number | null; created_at: number; updated_at: number;
  version: number | null; validated_at: number | null;
  remove_proposed_at: number | null; remove_reason: string | null; removed_at: number | null;
}

function rowOf(raw: RawCriterion): CriterionRow {
  let methods: string[] = [];
  let evidence: EvidenceItem[] = [];
  try { methods = JSON.parse(raw.methods); } catch { /* liste vide */ }
  if (!Array.isArray(methods)) methods = [];
  try { evidence = JSON.parse(raw.evidence ?? '[]'); } catch { /* pas de preuve */ }
  if (!Array.isArray(evidence)) evidence = [];
  return {
    ...raw,
    methods,
    evidence,
    status: raw.status as CriterionStatus,
    version: raw.version ?? 0,
  };
}

export function listCriteria(taskId: string, opts: { includeRemoved?: boolean } = {}): CriterionRow[] {
  if (!taskId) return [];
  const rows = db.query('SELECT * FROM criteria WHERE task_id = ? ORDER BY id ASC').all(taskId) as RawCriterion[];
  return rows
    .filter(r => opts.includeRemoved || r.removed_at == null)
    .map(rowOf);
}

export function getCriterion(taskId: string, ref: string, opts: { includeRemoved?: boolean } = {}): CriterionRow | null {
  const raw = db.query('SELECT * FROM criteria WHERE task_id = ? AND ref = ?').get(taskId, String(ref ?? '').trim()) as RawCriterion | undefined;
  if (!raw) return null;
  if (raw.removed_at != null && !opts.includeRemoved) return null;
  return rowOf(raw);
}

export interface CriteriaCounts {
  total: number; todo: number; toValidate: number; toFix: number; validated: number;
}

export function criteriaCounts(rows: CriterionRow[]): CriteriaCounts {
  const c: CriteriaCounts = { total: rows.length, todo: 0, toValidate: 0, toFix: 0, validated: 0 };
  for (const r of rows) {
    if (r.status === 'todo') c.todo++;
    else if (r.status === 'to_validate') c.toValidate++;
    else if (r.status === 'to_fix') c.toFix++;
    else if (r.status === 'validated') c.validated++;
  }
  return c;
}

/** Prochaine ref : compteur par tâche, jamais décrémenté (un retrait ne libère pas son numéro). */
export function nextRef(taskId: string): string {
  const row = db.query('SELECT criteria_seq s FROM task_state WHERE session_id = ?').get(taskId) as { s?: number | null } | undefined;
  const n = Number(row?.s ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new CriteriaError('limit', 'compteur de refs illisible');
  if (n >= MAX_REF_DIGITS) throw new CriteriaError('limit', `plafond de refs atteint (AC-${MAX_REF_DIGITS})`);
  return `AC-${String(n + 1).padStart(2, '0')}`;
}

function bumpRef(taskId: string) {
  // COALESCE : une ligne task_state créée avant le renommage porte criteria_seq NULL
  db.query(`INSERT INTO task_state (session_id, created_at, criteria_seq) VALUES (?,?,1)
            ON CONFLICT(session_id) DO UPDATE SET criteria_seq = COALESCE(criteria_seq, 0) + 1`)
    .run(taskId, Date.now());
}

function logTransition(taskId: string, ref: string, from: CriterionStatus | 'none', to: CriterionStatus | 'removed', source: 'agent' | 'verifier', note?: string) {
  logEvent(taskId, 'criteria', `${ref} : ${from} → ${to}${note ? ` : ${note}` : ''}`, { ref, from, to, source });
}

const STATUS_LABEL: Record<CriterionStatus, string> = {
  todo: 'à faire',
  to_validate: 'à valider',
  to_fix: 'à corriger',
  validated: 'validé',
};
export function statusLabel(s: CriterionStatus): string { return STATUS_LABEL[s]; }

/* --- Transitions (agent principal) --- */

export function addCriterion(taskId: string, p: { title: string; detail?: string; methods?: unknown }, source: 'agent' | 'verifier' = 'agent'): CriterionRow {
  const title = String(p.title ?? '').trim();
  if (!title) throw new CriteriaError('invalid', 'titre requis');
  const existing = listCriteria(taskId);
  if (existing.length >= MAX_CRITERIA) throw new CriteriaError('limit', `plafond de ${MAX_CRITERIA} critères par tâche atteint`);
  const methods = parseMethods(p.methods) ?? [];
  const ref = nextRef(taskId);
  const at = Date.now();
  db.query(`INSERT INTO criteria (task_id, ref, title, detail, methods, status, version, created_at, updated_at)
            VALUES (?,?,?,?,?,'todo',0,?,?)`)
    .run(taskId, ref, title.slice(0, MAX_TITLE), String(p.detail ?? '').trim().slice(0, MAX_DETAIL) || null,
      JSON.stringify(methods), at, at);
  bumpRef(taskId);
  logTransition(taskId, ref, 'none', 'todo', source, title.slice(0, 80));
  return getCriterion(taskId, ref)!;
}

export function removeCriterion(taskId: string, ref: string, source: 'agent' | 'verifier' = 'agent'): boolean {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  // suppression DOUCE : la ligne reste (historique des régressions), filtrée
  // des listes et comptes ; le vérificateur, lui, ne propose jamais de retrait
  // physique (voir proposeRemoval)
  db.query(`UPDATE criteria SET removed_at = ?, updated_at = ? WHERE task_id = ? AND ref = ?`)
    .run(Date.now(), Date.now(), taskId, row.ref);
  logTransition(taskId, row.ref, row.status, 'removed', source);
  return true;
}

export function updateCriterion(taskId: string, ref: string, patch: { title?: string; detail?: string; methods?: unknown }, source: 'agent' | 'verifier' = 'agent'): CriterionRow {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  const title = patch.title != null ? String(patch.title ?? '').trim() : undefined;
  const detail = patch.detail != null ? String(patch.detail ?? '').trim().slice(0, MAX_DETAIL) : undefined;
  const methods = parseMethods(patch.methods, { required: false });
  if (title === undefined && detail === undefined && methods === undefined) {
    throw new CriteriaError('invalid', 'rien à modifier : passe title, detail ou methods');
  }
  if (title !== undefined && !title) throw new CriteriaError('invalid', 'titre requis (non vide)');
  if (methods !== undefined && methods.length === 0) {
    throw new CriteriaError('invalid_method', 'au moins une méthode de validation est requise');
  }
  const invalidate = row.status !== 'todo';
  db.query(`UPDATE criteria SET
      title = COALESCE(?, title), detail = COALESCE(?, detail), methods = COALESCE(?, methods),
      status = ?, evidence = NULL, review = NULL, review_at = NULL, validated_at = NULL,
      remove_proposed_at = NULL, remove_reason = NULL,
      version = version + 1, updated_at = ?
      WHERE task_id = ? AND ref = ?`)
    .run(
      title ?? null, detail !== undefined ? (detail || null) : null,
      methods !== undefined ? JSON.stringify(methods) : null,
      invalidate ? 'todo' : row.status,
      Date.now(), taskId, row.ref,
    );
  logTransition(taskId, row.ref, row.status, invalidate ? 'todo' : row.status, source,
    invalidate ? 'contenu modifié : preuve invalidée' : 'contenu modifié');
  return getCriterion(taskId, row.ref)!;
}

export async function submitEvidence(taskId: string, ref: string, rawEvidence: unknown, projectDir?: string, source: 'agent' | 'verifier' = 'agent'): Promise<CriterionRow> {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  if (row.status !== 'todo' && row.status !== 'to_fix') {
    throw new CriteriaError('invalid_transition', `transition impossible : ${row.status} ; la preuve se soumet depuis « à faire » ou « à corriger »`);
  }
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new CriteriaError('invalid_evidence', 'au moins une preuve est requise');
  }
  const evidence: EvidenceItem[] = [];
  for (const item of rawEvidence.slice(0, MAX_EVIDENCE)) {
    const ev = validateEvidenceItem(item);
    if (ev.path && projectDir) {
      ev.path = await validateEvidencePath(projectDir, ev.path);
    } else if (ev.path && !projectDir) {
      // dossier du projet inconnu : la preuve sans vérification de chemin est refusée
      throw new CriteriaError('invalid_evidence', 'dossier du projet inconnu : preuve à chemin impossible à valider');
    }
    evidence.push(ev);
  }
  db.query(`UPDATE criteria SET status = 'to_validate', evidence = ?, review = NULL, review_at = NULL, validated_at = NULL,
              remove_proposed_at = NULL, remove_reason = NULL, version = version + 1, updated_at = ?
            WHERE task_id = ? AND ref = ?`)
    .run(JSON.stringify(evidence), Date.now(), taskId, row.ref);
  logTransition(taskId, row.ref, row.status, 'to_validate', source,
    evidence.map(e => e.kind).join(', '));
  return getCriterion(taskId, row.ref)!;
}

/* --- Transitions (daemon seul : retour JSON du vérificateur) --- */

/**
 * Approbation ATOMIQUE et versionnée : `UPDATE ... WHERE status='to_validate'
 * AND version = ?` ; si la version ne correspond plus (l'agent a soumis une
 * nouvelle preuve ou modifié le critère pendant la phase), le jugement périmé
 * est ignoré (`stale_judgment`) : jamais une approbation d'un état devenu
 * autre. `version` absent : repli sur la version courante (compatibilité).
 */
export function approveCriterion(taskId: string, ref: string, comment: string, version?: number): CriterionRow {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  const v = version ?? row.version;
  const at = Date.now();
  const changes = db.query(`UPDATE criteria SET status = 'validated', review = ?, review_at = ?, validated_at = ?, updated_at = ?
            WHERE task_id = ? AND ref = ? AND status = 'to_validate' AND version = ?`)
    .run(String(comment ?? '').trim().slice(0, 500) || null, at, at, at, taskId, row.ref, v).changes;
  if (!changes) {
    if (row.status !== 'to_validate') {
      throw new CriteriaError('invalid_transition', `approbation impossible : ${row.ref} est « ${statusLabel(row.status)} » (attendu : à valider)`);
    }
    throw new CriteriaError('stale_judgment', `jugement périmé : ${row.ref} a changé depuis (version examinée ${v}, version courante ${row.version})`);
  }
  logTransition(taskId, row.ref, 'to_validate', 'validated', 'verifier', comment);
  return getCriterion(taskId, row.ref)!;
}

/** Rejet versionné et atomique : même garde anti-péremption que l'approbation. */
export function rejectCriterion(taskId: string, ref: string, reason: string, version?: number): CriterionRow {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  const reasonClean = String(reason ?? '').trim();
  if (!reasonClean) throw new CriteriaError('invalid', 'une raison est requise pour un rejet');
  const v = version ?? row.version;
  const at = Date.now();
  const changes = db.query(`UPDATE criteria SET status = 'to_fix', review = ?, review_at = ?, updated_at = ?
            WHERE task_id = ? AND ref = ? AND status = 'to_validate' AND version = ?`)
    .run(reasonClean.slice(0, 500), at, at, taskId, row.ref, v).changes;
  if (!changes) {
    if (row.status !== 'to_validate') {
      throw new CriteriaError('invalid_transition', `rejet impossible : ${row.ref} est « ${statusLabel(row.status)} » (attendu : à valider)`);
    }
    throw new CriteriaError('stale_judgment', `jugement périmé : ${row.ref} a changé depuis (version examinée ${v}, version courante ${row.version})`);
  }
  logTransition(taskId, row.ref, 'to_validate', 'to_fix', 'verifier', reasonClean);
  return getCriterion(taskId, row.ref)!;
}

/**
 * Proposition de retrait : le vérificateur ne supprime JAMAIS physiquement.
 * La proposition reste visible (injection, UI, notification) jusqu'à ce que
 * l'agent retire le critère (criteria_remove) ou le modifie (criteria_update,
 * qui l'efface) ; idempotente à raison identique.
 */
export function proposeRemoval(taskId: string, ref: string, reason: string): CriterionRow {
  const row = getCriterion(taskId, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  const reasonClean = String(reason ?? '').trim();
  if (!reasonClean) throw new CriteriaError('invalid', 'une raison est requise pour une proposition de retrait');
  if (row.remove_proposed_at != null && row.remove_reason === reasonClean) return row;
  db.query(`UPDATE criteria SET remove_proposed_at = ?, remove_reason = ?, updated_at = ? WHERE task_id = ? AND ref = ?`)
    .run(Date.now(), reasonClean.slice(0, 500), Date.now(), taskId, row.ref);
  logEvent(taskId, 'criteria', `${row.ref} : retrait proposé par le vérificateur : ${reasonClean.slice(0, 120)}`,
    { ref: row.ref, from: row.status, to: row.status, source: 'verifier', removal_proposed: true });
  return getCriterion(taskId, row.ref)!;
}

/** Liste des refs « à valider » (le vérificateur n'a rien à juger quand elle est vide). */
export function pendingValidation(taskId: string): CriterionRow[] {
  return listCriteria(taskId).filter(r => r.status === 'to_validate');
}

/**
 * Message à pousser à l'agent quand son verdict est « done » mais que les
 * critères ne suivent pas : aucun critère, ou critères restants non validés.
 * Retourne null quand rien ne doit être poussé (critères tous validés).
 */
export function criteriaPushMessage(rows: CriterionRow[]): string | null {
  const counts = criteriaCounts(rows);
  if (!counts.total) {
    return "Il n'y a aucun critère d'acceptation pour cette tâche : définis-en avec criteria_add, puis soumets tes preuves avec criteria_to_validate.";
  }
  const remaining = rows.filter(r => r.status !== 'validated');
  if (!remaining.length) return null;
  return `Critères non validés : ${remaining.map(r => `${r.ref} (${statusLabel(r.status)})`).join(', ')} : soumets tes preuves avec criteria_to_validate.`;
}

/** Signature de l'état critères : le dédoublonnage du vérificateur s'appuie dessus. */
export function criteriaSignature(taskId: string): string {
  return listCriteria(taskId)
    .map(r => `${r.ref}|${r.status}|${r.version}|${r.updated_at}|${r.remove_proposed_at ?? 0}`)
    .join(';');
}
