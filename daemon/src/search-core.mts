/**
 * Noyau pur de la recherche de conversations (aucune lecture de base, aucun
 * réseau) : la fusion titre + messages et le découpage des extraits sont
 * testables sans instance ni flotte.
 *
 * Le module complet (search.mts) y ajoute le catalogue des sessions, l'appel à
 * l'index de messages d'OpenChamber et la restauration d'une carte fermée.
 */

/** En dessous, une recherche ne dit rien et coûte un aller-retour : on attend. */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_RESULTS = 12;

export interface SnippetSegment {
  text: string;
  match?: boolean;
}

export interface SearchResult {
  sessionId: string;
  title: string;
  /** nom du dossier du projet (dernier segment du chemin) */
  project: string;
  directory: string;
  /** dernière activité connue de la conversation */
  at: number;
  /** carte actuellement hors du tableau (fermée en « Terminé ») */
  closed: boolean;
  /** le titre contient la recherche */
  titleMatch: boolean;
  /** extrait du message trouvé, surligné par segments */
  snippet?: SnippetSegment[];
  /** rôle de l'auteur du message trouvé */
  role?: string;
}

/** Ce que la fusion a besoin de savoir d'une session (sous-ensemble de l'annuaire). */
export interface SearchSession {
  id: string;
  title?: string;
  parentID?: string;
  time?: Record<string, number>;
  location?: { directory?: string };
}

export interface MessageHit {
  sessionId?: string;
  role?: string;
  createdAt?: number;
  snippet?: string;
}

/** Minuscules sans accents : « Décision » et « decision » se rejoignent. */
export function normalizeForSearch(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const MATCH_START = '\uE000';
const MATCH_END = '\uE001';

/** Extrait de l'index -> segments, surlignage compris. */
export function parseSnippet(text: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let buffer = '';
  let match = false;
  const flush = () => {
    if (buffer) segments.push(match ? { text: buffer, match: true } : { text: buffer });
    buffer = '';
  };
  for (const char of String(text ?? '')) {
    if (char === MATCH_START) { flush(); match = true; continue; }
    if (char === MATCH_END) { flush(); match = false; continue; }
    buffer += char;
  }
  flush();
  return segments;
}

/** Dernier segment du chemin : le nom du projet affiché dans la liste. */
function projectName(directory: string | undefined): string {
  const path = String(directory ?? '').replace(/[\\/]+$/, '');
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || 'projet inconnu';
}

/** Une conversation qui n'est pas une carte de flotte ne se cherche pas. */
function usable(
  session: SearchSession | undefined,
  excludeDirs: string[],
): session is SearchSession {
  if (!session?.id) return false;
  if (session.parentID) return false;
  if (session.time?.archived) return false;
  const dir = String(session.location?.directory ?? '').replace(/[\\/]+$/, '');
  if (dir && excludeDirs.some((excluded) => excluded.replace(/[\\/]+$/, '') === dir)) return false;
  return true;
}

function lastActivityOf(session: SearchSession, fallback = 0): number {
  return session.time?.updated ?? session.time?.idle ?? session.time?.created ?? fallback;
}

/**
 * Fusion titre + messages, une entrée par conversation. Un titre qui correspond
 * ET un message qui correspond gardent l'extrait : il dit pourquoi la
 * conversation sort, et le titre dit de quoi elle parle.
 *
 * Ordre : les correspondances de titre d'abord (on cherche souvent une
 * conversation par son nom), puis la dernière activité décroissante.
 */
export function mergeSearch(input: {
  query: string;
  sessions: SearchSession[];
  hits: MessageHit[];
  closed?: Set<string>;
  /** dossiers qui ne sont pas des cartes de flotte (le chat de supervision) */
  excludeDirs?: string[];
}): SearchResult[] {
  const needle = normalizeForSearch(input.query);
  if (needle.length < SEARCH_MIN_CHARS) return [];
  const closed = input.closed ?? new Set<string>();
  const excludeDirs = input.excludeDirs ?? [];
  const sessions = new Map<string, SearchSession>();
  for (const session of input.sessions) {
    if (usable(session, excludeDirs)) sessions.set(session.id, session);
  }
  const results = new Map<string, SearchResult>();
  const entry = (session: SearchSession, at: number): SearchResult => ({
    sessionId: session.id,
    title: session.title?.trim() || 'Sans titre',
    project: projectName(session.location?.directory),
    directory: session.location?.directory ?? '',
    at,
    closed: closed.has(session.id),
    titleMatch: false,
  });
  // messages d'abord : ce sont eux qui portent l'extrait à afficher
  for (const hit of input.hits) {
    const session = hit.sessionId ? sessions.get(hit.sessionId) : undefined;
    if (!session || !hit.sessionId) continue;
    const at = lastActivityOf(session, Number(hit.createdAt) || 0);
    const existing = results.get(hit.sessionId);
    if (existing) {
      if (existing.snippet) continue;
      existing.snippet = parseSnippet(String(hit.snippet ?? ''));
      existing.role = hit.role;
      continue;
    }
    results.set(hit.sessionId, {
      ...entry(session, at),
      snippet: parseSnippet(String(hit.snippet ?? '')),
      role: hit.role,
    });
  }
  // puis les titres : marque un résultat déjà présent, ou en ajoute un
  for (const [id, session] of sessions) {
    if (!normalizeForSearch(session.title ?? '').includes(needle)) continue;
    const existing = results.get(id);
    if (existing) { existing.titleMatch = true; continue; }
    results.set(id, { ...entry(session, lastActivityOf(session)), titleMatch: true });
  }
  return [...results.values()]
    .sort((a, b) => {
      if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
      return b.at - a.at;
    })
    .slice(0, SEARCH_MAX_RESULTS);
}
