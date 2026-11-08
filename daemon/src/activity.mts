/**
 * Activité courante d'une session de travail.
 *
 * Source principale : le flux SSE d'OpenChamber, qui publie les étapes du tour
 * (`session.reasoning.*`, `session.text.*`, `session.tool.*`). Aucun appel HTTP
 * n'est fait pour une session dont les événements arrivent : l'activité est un
 * dérivé direct, remplacé en place (jamais empilé).
 *
 * Filet : au démarrage du daemon, après une coupure SSE, ou quand un outil
 * dure plus de RECONCILE_MS sans nouvel événement, on relit la queue de la
 * conversation (`/api/session/:id/message`) et on dérive l'état du dernier
 * message. Le résultat est identique à celui des événements.
 *
 * Règles de lecture (alignées sur OpenChamber, `useAssistantStatus.ts`) :
 * outils de lecture/édition/écriture/recherche/commande regroupés par type ;
 * une commande est réduite à sa première ligne ; un chemin à son nom de
 * fichier. L'UI ne tronque que visuellement (CSS), le texte complet reste dans
 * l'infobulle.
 */

export type ActivityKind =
  | 'thinking'
  | 'writing'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'shell'
  | 'tool';

export interface LiveActivity {
  kind: ActivityKind;
  /** Libellé court et stable, déjà en français (Réflexion, Édition...). */
  label: string;
  /** Sujet de l'action : nom de fichier, motif, commande. */
  detail?: string;
  /** Texte complet pour l'infobulle (chemin, commande entière). */
  title?: string;
  /** Date du dernier événement qui a produit cet état. */
  at: number;
}

interface WirePart {
  type?: string;
  tool?: string;
  name?: string;
  text?: string;
  time?: { created?: number; completed?: number; start?: number; end?: number };
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    time?: { start?: number; end?: number };
  };
}

export interface WireMessage {
  id?: string;
  time?: { created?: number };
  content?: WirePart[];
}

/** Longueurs bornées : le SSE transporte cet état à chaque frame. */
const MAX_DETAIL = 72;
const MAX_COMMAND = 96;
const MAX_TITLE = 240;
const RECONCILE_MS = 20_000;
const RETRY_MS = 10_000;
const COMPLETED_GRACE_MS = 3_000;
const MAX_SESSIONS = 300;

const THINKING: Omit<LiveActivity, 'at'> = { kind: 'thinking', label: 'Réflexion' };
const WRITING: Omit<LiveActivity, 'at'> = { kind: 'writing', label: 'Rédaction' };

interface ToolRule {
  kind: ActivityKind;
  label: string;
  /** Champ d'entrée qui porte le sujet (chemin, motif, commande). */
  subject?: 'path' | 'pattern' | 'command' | 'query' | 'url';
}

/**
 * Noms d'outils OpenCode/OpenChamber. Les alias couvrent les générations
 * (`bash` → `shell`, `task` → `subagent`) et les outils MCP qui exposent un
 * chemin. Un outil inconnu garde un libellé générique et son nom en détail.
 */
const TOOL_RULES: Record<string, ToolRule> = {
  read: { kind: 'read', label: 'Lecture', subject: 'path' },
  'file-diff': { kind: 'read', label: 'Lecture', subject: 'path' },
  view: { kind: 'read', label: 'Lecture', subject: 'path' },
  file_read: { kind: 'read', label: 'Lecture', subject: 'path' },
  edit: { kind: 'edit', label: 'Édition', subject: 'path' },
  patch: { kind: 'edit', label: 'Édition', subject: 'path' },
  str_replace: { kind: 'edit', label: 'Édition', subject: 'path' },
  str_replace_based_edit_tool: { kind: 'edit', label: 'Édition', subject: 'path' },
  write: { kind: 'write', label: 'Écriture', subject: 'path' },
  create: { kind: 'write', label: 'Écriture', subject: 'path' },
  file_write: { kind: 'write', label: 'Écriture', subject: 'path' },
  grep: { kind: 'search', label: 'Recherche', subject: 'pattern' },
  glob: { kind: 'search', label: 'Recherche', subject: 'pattern' },
  find: { kind: 'search', label: 'Recherche', subject: 'pattern' },
  ripgrep: { kind: 'search', label: 'Recherche', subject: 'pattern' },
  ls: { kind: 'read', label: 'Dossiers', subject: 'path' },
  list: { kind: 'read', label: 'Dossiers', subject: 'path' },
  list_files: { kind: 'read', label: 'Dossiers', subject: 'path' },
  shell: { kind: 'shell', label: 'Commande', subject: 'command' },
  bash: { kind: 'shell', label: 'Commande', subject: 'command' },
  cmd: { kind: 'shell', label: 'Commande', subject: 'command' },
  terminal: { kind: 'shell', label: 'Commande', subject: 'command' },
  shell_command: { kind: 'shell', label: 'Commande', subject: 'command' },
  execute: { kind: 'shell', label: 'Commande', subject: 'command' },
  webfetch: { kind: 'read', label: 'Lecture web', subject: 'url' },
  fetch: { kind: 'read', label: 'Lecture web', subject: 'url' },
  websearch: { kind: 'search', label: 'Recherche web', subject: 'query' },
  'web-search': { kind: 'search', label: 'Recherche web', subject: 'query' },
  codesearch: { kind: 'search', label: 'Recherche web', subject: 'query' },
  // outils du Superviseur / d'OpenChamber : libellé parlant, icône générique
  planwrite: { kind: 'tool', label: 'Plan' },
  planupdate: { kind: 'tool', label: 'Plan' },
  todowrite: { kind: 'tool', label: 'Plan' },
  todoupdate: { kind: 'tool', label: 'Plan' },
  answer: { kind: 'tool', label: 'Réponse' },
  question: { kind: 'tool', label: 'Question' },
  criteria_add: { kind: 'tool', label: 'Critères' },
  criteria_list: { kind: 'tool', label: 'Critères' },
  criteria_update: { kind: 'tool', label: 'Critères' },
  criteria_remove: { kind: 'tool', label: 'Critères' },
  criteria_to_validate: { kind: 'tool', label: 'Critères' },
  start_task: { kind: 'tool', label: 'Tâche' },
  send_task: { kind: 'tool', label: 'Tâche' },
  close_task: { kind: 'tool', label: 'Tâche' },
  openchamber_render: { kind: 'tool', label: 'Rendu' },
  openchamber_web: { kind: 'tool', label: 'Navigateur' },
  openchamber_knowledge: { kind: 'tool', label: 'Connaissances' },
  openchamber_schedule: { kind: 'tool', label: 'Planification' },
  openchamber_secret: { kind: 'tool', label: 'Secret' },
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** Une ligne, espaces normalisés : jamais de retour à la ligne dans la carte. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Nom de fichier seul (les chemins complets restent dans l'infobulle). */
export function baseName(path: string): string {
  const clean = path.replace(/[/\\]+$/, '');
  const index = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return index >= 0 ? clean.slice(index + 1) : clean;
}

function normalizedToolName(name: string): string {
  return name.trim().toLowerCase().replace(/:\d+$/, '');
}

function pathOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  return text(input.path) ?? text(input.filePath) ?? text(input.file_path) ?? text(input.file);
}

function commandOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const command = text(input.command) ?? text(input.cmd) ?? text(input.code);
  return command ? oneLine(command.split(/\r?\n/)[0] ?? command) : undefined;
}

function subjectOf(rule: ToolRule, input: Record<string, unknown> | undefined): {
  detail?: string;
  title?: string;
} {
  if (!input) return {};
  switch (rule.subject) {
    case 'path': {
      const path = pathOf(input);
      if (!path) return {};
      return { detail: clamp(baseName(path), MAX_DETAIL), title: clamp(path, MAX_TITLE) };
    }
    case 'pattern': {
      const pattern = text(input.pattern) ?? text(input.query);
      return pattern ? { detail: clamp(oneLine(pattern), MAX_DETAIL), title: clamp(pattern, MAX_TITLE) } : {};
    }
    case 'command': {
      const command = commandOf(input);
      return command ? { detail: clamp(command, MAX_COMMAND), title: clamp(command, MAX_TITLE) } : {};
    }
    case 'query': {
      const query = text(input.query) ?? text(input.q);
      return query ? { detail: clamp(oneLine(query), MAX_DETAIL), title: clamp(query, MAX_TITLE) } : {};
    }
    case 'url': {
      const url = text(input.url);
      return url ? { detail: clamp(url, MAX_DETAIL), title: clamp(url, MAX_TITLE) } : {};
    }
    default:
      return {};
  }
}

/**
 * Traduit un appel d'outil en ligne d'activité. `input` peut être incomplet
 * pendant le streaming des arguments : le libellé générique du type s'affiche
 * alors sans sujet, puis se précise à l'événement `session.tool.called`.
 */
export function toolActivity(name: string, input?: Record<string, unknown>, at = Date.now()): LiveActivity {
  const normalized = normalizedToolName(name);
  const rule = TOOL_RULES[normalized];
  if (!rule) {
    return {
      kind: 'tool',
      label: 'Outil',
      detail: clamp(normalized, MAX_DETAIL),
      title: normalized,
      at,
    };
  }
  return { kind: rule.kind, label: rule.label, ...subjectOf(rule, input), at };
}

/**
 * Suivi en mémoire des activités, alimenté par le SSE. Une session n'a qu'une
 * activité : set remplace, jamais d'historique.
 */
export class ActivityTracker {
  private readonly bySession = new Map<string, LiveActivity>();
  /**
   * `session.tool.input.started` porte le nom de l'outil, `session.tool.called`
   * porte son entrée complète mais pas toujours le nom : on les relie par l'id
   * de l'appel. (Constaté sur l'instance : `called` sans `name`, d'où un libellé
   * qui restait bloqué sur « Réflexion » alors que la commande tournait.)
   */
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  ingest(type: string, data: Record<string, unknown>): void {
    const sessionId = text(data.sessionID);
    if (!sessionId) return;
    const at = this.now();

    switch (type) {
      case 'session.execution.started':
      case 'session.step.started':
        this.set(sessionId, { ...THINKING, at });
        return;
      case 'session.reasoning.started':
      case 'session.reasoning.delta':
        this.set(sessionId, { ...THINKING, at });
        return;
      case 'session.reasoning.ended':
        // la fin du raisonnement précède souvent le tool.called : ne pas
        // écraser le libellé de l'outil que session.tool.input.started vient
        // de poser (sinon la carte reste sur « Réflexion » pendant l'outil)
        return;
      case 'session.text.started':
      case 'session.text.delta':
        this.set(sessionId, { ...WRITING, at });
        return;
      case 'session.tool.input.started': {
        const id = text(data.id);
        const name = text(data.name) ?? text(data.tool);
        if (id && name) {
          this.toolNames.set(id, name);
          if (this.toolNames.size > 200) {
            const oldest = this.toolNames.keys().next().value;
            if (oldest) this.toolNames.delete(oldest);
          }
        }
        if (!name) return;
        this.set(sessionId, toolActivity(name, record(data.input), at));
        return;
      }
      case 'session.tool.called': {
        const id = text(data.id);
        const name = text(data.name) ?? text(data.tool) ?? (id ? this.toolNames.get(id) : undefined);
        if (!name) return;
        const input = record(data.input);
        this.set(sessionId, toolActivity(name, input, at));
        if (id) this.toolNames.delete(id);
        return;
      }
      case 'session.tool.progress': {
        // les métadonnées progressent mais le sujet ne change pas : garder la
        // ligne stable ; sans ligne connue, poser le libellé générique
        if (this.bySession.has(sessionId)) return;
        const name = text(data.name) ?? text(data.tool);
        if (name) this.set(sessionId, toolActivity(name, undefined, at));
        return;
      }
      case 'session.tool.success':
      case 'session.tool.failed':
        // l'outil est fini ; le tour enchaîne souvent sur une réflexion ou un
        // autre outil. On garde la dernière ligne (stable) jusqu'au prochain
        // événement, l'exposition restant conditionnée au statut busy.
        return;
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
      case 'session.idle':
        this.bySession.delete(sessionId);
        return;
      default:
        return;
    }
  }

  set(sessionId: string, activity: LiveActivity): void {
    this.bySession.set(sessionId, activity);
    if (this.bySession.size > MAX_SESSIONS) {
      const oldest = this.bySession.keys().next().value;
      if (oldest) this.bySession.delete(oldest);
    }
  }

  get(sessionId: string): LiveActivity | undefined {
    return this.bySession.get(sessionId);
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  clearAll(): void {
    this.bySession.clear();
  }

  get size(): number {
    return this.bySession.size;
  }
}

export const activityTracker = new ActivityTracker();

/**
 * Dérive l'activité du dernier message assistant d'une fenêtre (ordre indifférent).
 * Priorité : outil en cours → réflexion → texte → outil tout juste terminé →
 * réflexion (le tour est busy, le modèle enchaîne).
 */
export function deriveActivityFromMessages(messages: WireMessage[], now = Date.now()): LiveActivity | undefined {
  const ordered = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  const last = ordered.at(-1);
  const parts = last?.content ?? [];
  if (!parts.length) return undefined;

  // outil encore en cours (plusieurs appels parallèles : le plus récent gagne)
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part?.type !== 'tool') continue;
    const status = part.state?.status;
    if (status === 'running' || status === 'pending' || status === 'started') {
      return toolActivity(part.tool ?? part.name ?? '', part.state?.input, now);
    }
  }

  const tail = parts[parts.length - 1];
  if (tail?.type === 'tool') {
    const ended = tail.state?.time?.end ?? tail.time?.completed;
    if (typeof ended === 'number' && now - ended < COMPLETED_GRACE_MS) {
      return toolActivity(tail.tool ?? tail.name ?? '', tail.state?.input, now);
    }
  }
  if (tail?.type === 'reasoning') return { ...THINKING, at: now };
  if (tail?.type === 'text') return { ...WRITING, at: now };
  // un outil terminé plus ancien, puis rien : le modèle réfléchit au résultat
  if (parts.some((part) => part?.type === 'reasoning' || part?.type === 'tool')) {
    return { ...THINKING, at: now };
  }
  return undefined;
}

/* --- Filet : lecture de la fin de conversation ------------------------------ */

let activityBase = '';
export function setActivityBase(base: string): void {
  activityBase = base.replace(/\/$/, '');
}

const lastAttempt = new Map<string, number>();
const inFlight = new Map<string, Promise<LiveActivity | undefined>>();

async function fetchActivity(sessionId: string): Promise<LiveActivity | undefined> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`${activityBase}/api/session/${sessionId}/message?limit=12&order=desc`, {
      signal: ctl.signal,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: WireMessage[] };
    return deriveActivityFromMessages(body.data ?? []);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Activité à publier pour une carte.
 * - session hors busy : rien (et purge, aucune ligne résiduelle au repos) ;
 * - événement récent : la ligne du tracker, sans requête ;
 * - sinon : relecture bornée de la conversation, au plus toutes les RETRY_MS.
 */
export async function activityOf(sessionId: string, busy: boolean): Promise<LiveActivity | undefined> {
  if (!busy) {
    activityTracker.clear(sessionId);
    return undefined;
  }
  const now = Date.now();
  const hit = activityTracker.get(sessionId);
  if (hit && now - hit.at < RECONCILE_MS) return hit;

  const attempted = lastAttempt.get(sessionId) ?? 0;
  if (now - attempted < RETRY_MS) return hit;
  lastAttempt.set(sessionId, now);

  const pending = inFlight.get(sessionId);
  if (pending) return pending;
  const fetchStartedAt = now;
  const request = fetchActivity(sessionId)
    .then((derived) => {
      if (!derived) return activityTracker.get(sessionId);
      // un événement arrivé pendant la requête est plus frais : ne pas l'écraser
      const current = activityTracker.get(sessionId);
      if (current && current.at > fetchStartedAt) return current;
      activityTracker.set(sessionId, derived);
      return derived;
    })
    .finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, request);
  return request;
}

/** Pour les tests : purge complète de l'état module. */
export function resetActivity(): void {
  activityTracker.clearAll();
  lastAttempt.clear();
  inFlight.clear();
}
