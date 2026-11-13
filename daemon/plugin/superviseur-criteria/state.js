/**
 * SuperviseurCriteria : machine à états PURE des critères d'acceptation.
 * -----------------------------------------------------------------------------
 * Depuis la migration « critères natifs session » (décision du propriétaire,
 * 2026-11-13), l'état vit dans le storage du plugin (ctx.storage, clé
 * `session/<sessionID>`), comme le plan vit dans superviseur-plan. Ce module
 * porte TOUTE la logique : validation, transitions, refs, preuves. index.js
 * ne fait que le branchement tools/storage.
 *
 * Dependence-free ESM : seuls les modules node sont importés (fs, path,
 * child_process pour le commit de validated_work). Testé directement par
 * daemon/test/criteria-state.test.mts sans passer par OpenCode.
 *
 * États d'un critère (spécification : docs/analyses/mvp1/criteres-acceptation.md) :
 *   todo        à faire
 *   to_validate à valider (preuve soumise)
 *   to_fix      à corriger (raison enregistrée)
 *   validated   validé (jugement de l'agent lui-même)
 *
 * Transitions :
 *   - add → todo ;
 *   - to_validate : todo|to_fix → to_validate (preuve requise, chemin vérifié) ;
 *   - set_status (l'agent juge lui-même) : → validated (commentaire) ou to_fix
 *     (raison requise) ; l'honnêteté de l'usage est portée par les instructions
 *     du tool, la machine ne l'impose pas ;
 *   - update de contenu : un critère non todo repasse todo (preuve invalidée) ;
 *   - remove : suppression douce, ref jamais réattribuée (prochaine ref =
 *     max des refs connues, retraits compris, + 1).
 */

import { lstat, realpath, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const METHODS = [
  'unit_test', 'e2e', 'browser_nav', 'screenshot', 'human', 'text',
  'code_excerpt', 'artifact', 'command', 'diff', 'doc',
];

export const METHOD_SET = new Set(METHODS);
export const MAX_CRITERIA = 12;
export const MAX_TITLE = 200;
export const MAX_DETAIL = 2000;
export const MAX_EVIDENCE = 8;
export const MAX_REF_DIGITS = 99;
export const MAX_NOTE = 500;
export const MAX_EVIDENCE_TEXT = 2000;

export class CriteriaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const STATUSES = ['todo', 'to_validate', 'to_fix', 'validated'];
const STATUS_SET = new Set(STATUSES);

const STATUS_LABEL = {
  todo: 'à faire',
  to_validate: 'à valider',
  to_fix: 'à corriger',
  validated: 'validé',
};
export function statusLabel(s) { return STATUS_LABEL[s] ?? String(s); }

/* --- État porté par la session --- */

/** État vide : { criteria: [] }. L'ordre du tableau est l'ordre de création. */
export function emptyState() {
  return { criteria: [] };
}

const CLONE_FIELDS = [
  'ref', 'title', 'detail', 'methods', 'status', 'evidence',
  'review', 'review_at', 'created_at', 'updated_at',
  'version', 'validated_at', 'validated_work', 'removed_at',
];

/** Coerce un critère brut (storage, metadata d'un tool part, import) en forme propre. */
export function normalizeCriterion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ref = String(raw.ref ?? '').trim();
  const title = String(raw.title ?? '').trim();
  if (!ref || !title) return null;
  const methods = Array.isArray(raw.methods)
    ? [...new Set(raw.methods.map(m => String(m ?? '').trim().toLowerCase()).filter(m => METHOD_SET.has(m)))]
    : [];
  if (methods.length === 0) return null;
  const status = STATUS_SET.has(raw.status) ? raw.status : 'todo';
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map(normalizeEvidenceStored).filter(Boolean)
    : [];
  const out = {};
  for (const f of CLONE_FIELDS) {
    if (raw[f] !== undefined) out[f] = raw[f];
  }
  out.ref = ref;
  out.title = title.slice(0, MAX_TITLE);
  out.detail = raw.detail != null ? String(raw.detail).slice(0, MAX_DETAIL) : null;
  out.methods = methods;
  out.status = status;
  out.evidence = evidence;
  out.review = raw.review != null ? String(raw.review).slice(0, MAX_NOTE) : null;
  out.review_at = raw.review_at ?? null;
  out.created_at = Number(raw.created_at) || Date.now();
  out.updated_at = Number(raw.updated_at) || out.created_at;
  out.version = Number(raw.version) || 0;
  out.validated_at = raw.validated_at ?? null;
  out.validated_work = raw.validated_work ?? null;
  out.removed_at = raw.removed_at ?? null;
  return out;
}

/** Preuve déjà stockée (historique) : tolérante, sans revalidation de chemin. */
function normalizeEvidenceStored(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind ?? '').trim().toLowerCase();
  const text = String(raw.text ?? '').trim();
  if (!METHOD_SET.has(kind) || !text) return null;
  const out = { kind, text: text.slice(0, MAX_EVIDENCE_TEXT), at: Number(raw.at) || 0 };
  if (raw.path) out.path = String(raw.path);
  if (raw.start_line != null) out.start_line = Number(raw.start_line);
  if (raw.line_count != null) out.line_count = Number(raw.line_count);
  return out;
}

/**
 * Coerce l'état stocké (ou une liste importée) en état propre : critères
 * valides seulement, refs dédoublonnées (le premier garde sa ref, les
 * suivants reçoivent une ref neuve), ordre d'entrée conservé.
 */
export function normalizeState(raw) {
  const state = emptyState();
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.criteria) ? raw.criteria : [];
  const seen = new Set();
  for (const item of list) {
    const c = normalizeCriterion(item);
    if (!c) continue;
    if (seen.has(c.ref)) c.ref = `AC-${String(nextRefNumber(state) + 1).padStart(2, '0')}`;
    seen.add(c.ref);
    state.criteria.push(c);
  }
  return state;
}

export function listCriteria(state, { includeRemoved = false } = {}) {
  const rows = Array.isArray(state?.criteria) ? state.criteria : [];
  return includeRemoved ? rows : rows.filter(r => r.removed_at == null);
}

export function getCriterion(state, ref, { includeRemoved = false } = {}) {
  const key = String(ref ?? '').trim();
  const row = listCriteria(state, { includeRemoved: true }).find(r => r.ref === key);
  if (!row) return null;
  if (row.removed_at != null && !includeRemoved) return null;
  return row;
}

export function criteriaCounts(rows) {
  const c = { total: rows.length, todo: 0, toValidate: 0, toFix: 0, validated: 0 };
  for (const r of rows) {
    if (r.status === 'todo') c.todo++;
    else if (r.status === 'to_validate') c.toValidate++;
    else if (r.status === 'to_fix') c.toFix++;
    else if (r.status === 'validated') c.validated++;
  }
  return c;
}

export function criteriaView(state, { includeRemoved = false } = {}) {
  const rows = listCriteria(state, { includeRemoved });
  return { ok: true, criteria: rows, counts: criteriaCounts(rows) };
}

/* --- Refs : max connu + 1 (retraits compris, jamais réattribuées) --- */

function refNumber(ref) {
  const m = /^AC-(\d+)$/.exec(String(ref ?? '').trim());
  return m ? Number(m[1]) : 0;
}

function nextRefNumber(state) {
  let max = 0;
  for (const r of listCriteria(state, { includeRemoved: true })) {
    const n = refNumber(r.ref);
    if (n > max) max = n;
  }
  return max;
}

/** Prochaine ref du state : jamais décrémentée (un retrait ne libère pas son numéro). */
export function nextRef(state) {
  const n = nextRefNumber(state);
  if (n >= MAX_REF_DIGITS) throw new CriteriaError('limit', `plafond de refs atteint (AC-${MAX_REF_DIGITS})`);
  return `AC-${String(n + 1).padStart(2, '0')}`;
}

/* --- Validation des entrées --- */

export function parseMethods(raw, { required = true } = {}) {
  if (raw == null) {
    if (required) throw new CriteriaError('invalid_method', 'au moins une méthode de validation est requise');
    return undefined;
  }
  if (!Array.isArray(raw)) throw new CriteriaError('invalid_method', 'methods doit être un tableau');
  const out = [];
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

function validateEvidenceItem(item) {
  if (!item || typeof item !== 'object') throw new CriteriaError('invalid_evidence', 'chaque preuve doit être un objet');
  const kind = String(item.kind ?? '').trim().toLowerCase();
  if (!METHOD_SET.has(kind)) {
    throw new CriteriaError('invalid_evidence', `type de preuve inconnu : ${kind || '(vide)'}`);
  }
  const text = String(item.text ?? '').trim();
  if (!text) throw new CriteriaError('invalid_evidence', 'chaque preuve exige un texte (ce qui prouve le critère)');
  const out = { kind, text: text.slice(0, MAX_EVIDENCE_TEXT), at: Date.now() };
  const path = String(item.path ?? '').trim();
  if (path) out.path = path;
  if (kind === 'code_excerpt') {
    const startLine = Math.floor(Number(item.start_line));
    const lineCount = Math.floor(Number(item.line_count));
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

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Vérifie qu'un chemin de preuve est un fichier existant du projet (relatif, sans sortie). */
export async function validateEvidencePath(projectDir, rawPath) {
  const value = String(rawPath ?? '').trim();
  if (!value) throw new CriteriaError('invalid_evidence', 'chemin de preuve requis');
  if (value.length > 1024 || value.includes('\0') || isAbsolute(value)) {
    throw new CriteriaError('invalid_evidence', 'chemin relatif requis pour la preuve');
  }
  const parts = value.split(/[\\/]+/).filter(p => p && p !== '.');
  if (parts.some(p => p === '..')) throw new CriteriaError('invalid_evidence', 'sortie du projet interdite');
  let root;
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

/* --- Transitions --- */

export function addCriterion(state, p) {
  const title = String(p?.title ?? '').trim();
  if (!title) throw new CriteriaError('invalid', 'titre requis');
  const existing = listCriteria(state);
  // plafond anti-explosion : il porte sur le travail NON validé (todo,
  // à valider, à corriger) ; les critères validés sont de l'histoire et
  // n'empêchent pas d'ajouter de nouveaux critères (tâche de supervision
  // longue : les instructions successives s'accumulent)
  const pending = existing.filter(r => r.status !== 'validated').length;
  if (pending >= MAX_CRITERIA) throw new CriteriaError('limit', `plafond de ${MAX_CRITERIA} critères non validés atteint`);
  const methods = parseMethods(p.methods) ?? [];
  const ref = nextRef(state);
  const at = Date.now();
  const row = {
    ref,
    title: title.slice(0, MAX_TITLE),
    detail: String(p.detail ?? '').trim().slice(0, MAX_DETAIL) || null,
    methods,
    status: 'todo',
    evidence: [],
    review: null,
    review_at: null,
    created_at: at,
    updated_at: at,
    version: 0,
    validated_at: null,
    validated_work: null,
    removed_at: null,
  };
  state.criteria.push(row);
  return row;
}

export function removeCriterion(state, ref) {
  const row = getCriterion(state, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  // suppression DOUCE : la ligne reste (historique des régressions), filtrée
  // des listes et comptes
  row.removed_at = Date.now();
  row.updated_at = row.removed_at;
  return true;
}

export function updateCriterion(state, ref, patch) {
  const row = getCriterion(state, ref);
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
  if (title !== undefined) row.title = title.slice(0, MAX_TITLE);
  if (detail !== undefined) row.detail = detail || null;
  if (methods !== undefined) row.methods = methods;
  if (invalidate) {
    row.status = 'todo';
    row.evidence = [];
    row.review = null;
    row.review_at = null;
    row.validated_at = null;
    row.validated_work = null;
  }
  row.version += 1;
  row.updated_at = Date.now();
  return row;
}

export async function submitEvidence(state, ref, rawEvidence, projectDir) {
  const row = getCriterion(state, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  if (row.status !== 'todo' && row.status !== 'to_fix') {
    throw new CriteriaError('invalid_transition', `transition impossible : ${row.status} ; la preuve se soumet depuis « à faire » ou « à corriger »`);
  }
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) {
    throw new CriteriaError('invalid_evidence', 'au moins une preuve est requise');
  }
  const evidence = [];
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
  row.status = 'to_validate';
  row.evidence = evidence;
  row.review = null;
  row.review_at = null;
  row.validated_at = null;
  row.validated_work = null;
  row.version += 1;
  row.updated_at = Date.now();
  return row;
}

/* --- Jugement par l'agent lui-même (criteria_set_status) --- */

/**
 * Version du travail COURANTE : commit du dossier projet quand disponible
 * (certaines tâches vivent hors git) + horodatage ; enregistrée avec chaque
 * validation pour que l'UI distingue « validé sur l'état actuel » d'un
 * « validé avant les dernières modifications ».
 */
export function currentWorkVersion(dir) {
  let commit = null;
  if (dir) {
    try {
      const out = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
      const hash = String(out.stdout ?? '').trim();
      if (out.status === 0 && /^[0-9a-f]{40}$/.test(hash)) commit = hash;
    } catch { /* pas git : indéterminable */ }
  }
  return { commit, at: Date.now() };
}

/**
 * L'agent fixe lui-même le statut final d'un critère : `validated`
 * (commentaire recommandé) ou `to_fix` (raison requise). Transitions tolérantes
 * depuis n'importe quel état vivant : l'agent peut se corriger (to_fix) puis
 * revalider, ou marquer validé sans repasser par une preuve soumise. L'écriture
 * porte une version incrémentée (l'historique des jugements reste daté).
 * `workDir` alimente `validated_work` (commit courant).
 */
export function setStatusCriterion(state, ref, status, note, workDir) {
  const row = getCriterion(state, ref);
  if (!row) throw new CriteriaError('unknown_ref', `critère inconnu : ${ref}`);
  if (status !== 'validated' && status !== 'to_fix') {
    throw new CriteriaError('invalid_transition', `statut impossible : ${status} ; criteria_set_status porte « validé » ou « à corriger »`);
  }
  const clean = String(note ?? '').trim();
  if (status === 'to_fix' && !clean) {
    throw new CriteriaError('invalid', 'une raison est requise pour passer un critère « à corriger »');
  }
  const at = Date.now();
  row.status = status;
  row.review = clean.slice(0, MAX_NOTE) || null;
  row.review_at = at;
  if (status === 'validated') {
    row.validated_at = at;
    row.validated_work = JSON.stringify(currentWorkVersion(workDir));
  }
  row.version += 1;
  row.updated_at = at;
  return row;
}

/**
 * Import d'une liste complète (reprise automatique : le daemon réinjecte le
 * dernier état connu de la tâche perdue dans la session neuve). Remplace
 * l'état ; tolérant sur l'historique (preuves non revalidées), strict sur la
 * forme (ref + titre + méthodes requis, refs dédoublonnées, prochaines refs
 * continuent au-delà du max importé).
 */
export function importCriteria(rawList) {
  return normalizeState(rawList);
}
