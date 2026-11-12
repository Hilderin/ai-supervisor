/** Contrat de données du daemon (`GET /api/fleet`, SSE `/api/fleet/stream`). */

export interface FormOption {
  value: string;
  label: string;
  description?: string;
}

export interface FormField {
  key?: string;
  title?: string;
  description?: string;
  type?: string;
  options?: FormOption[];
  custom?: boolean;
}

export interface PendingForm {
  id: string;
  sessionID?: string;
  title?: string;
  metadata?: { kind?: string; tool?: { messageID?: string; id?: string } };
  fields?: FormField[];
}

export interface PendingPermission {
  id?: string;
  [key: string]: unknown;
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed';

export interface PlanStep {
  text: string;
  status: PlanStepStatus;
}

/* --- Critères d'acceptation (docs/analyses/mvp1/criteres-acceptation.md) --- */

export type CriterionStatus = 'todo' | 'to_validate' | 'to_fix' | 'validated';

/** Preuve soumise avec `criteria_to_validate`. */
export interface EvidenceItem {
  kind: string;
  text: string;
  path?: string;
  start_line?: number;
  line_count?: number;
  at: number;
}

export interface Criterion {
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
  /** version du contenu (preuve, jugement ou modification) */
  version?: number;
  validated_at?: number | null;
  /** version du travail validé : JSON {commit?, at} */
  validated_work?: string | null;
  /** suppression douce : la ligne reste, filtrée des listes */
  removed_at?: number | null;
}

export interface CriteriaCounts {
  total: number;
  todo: number;
  toValidate: number;
  toFix: number;
  validated: number;
}

/** Activité courante d'une tâche busy (dérivée du SSE OpenChamber). */
export type ActivityKind =
  | 'thinking'
  | 'writing'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'shell'
  | 'tool';

export interface FleetActivity {
  kind: ActivityKind;
  /** Libellé court, déjà en français. */
  label: string;
  /** Sujet : nom de fichier, motif, commande. */
  detail?: string;
  /** Texte complet pour l'infobulle. */
  title?: string;
  at: number;
}

export interface FleetRow {
  id: string;
  title: string;
  status: string;
  /** Dernier échec OpenCode ou retry planifié, reçu par le SSE. */
  issue?: {
    state: 'error' | 'retry';
    message?: string;
    errorType?: string;
    errorStatus?: number;
    attempt?: number;
    /** Début prévu de la tentative relancée (epoch ms) : au-delà, le daemon a déjà effacé le signal. */
    retryAt?: number;
    updatedAt: number;
  };
  dir?: string;
  turnStartedAt?: number;
  lastUpdateAt?: number;
  busy?: number | null;
  idle?: number | null;
  pendingForms: PendingForm[];
  pendingPermissions: PendingPermission[];
  /** ajouté par GET /api/fleet (pas par le SSE) */
  task?: { closed_at?: number } | null;
  /** plan de la session de travail (`planwrite`) */
  plan?: { done: number; total: number; steps: PlanStep[] };
  /** critères d'acceptation : comptes par état (la liste détaillée se charge à la demande) */
  criteria?: CriteriaCounts;
  /** ce que l'agent fait à l'instant (uniquement pendant un tour busy) */
  activity?: FleetActivity;
  /** réponses au propriétaire (tool `answer`) pas encore lues (« Got it ») */
  unreadAnswers?: number;
}

/** Réponse d'une tâche au propriétaire, `GET /api/fleet/answers?sessionId=…`. */
export interface TaskAnswer {
  id: number;
  at: number;
  text: string;
  question?: string | null;
  read_at?: number | null;
}

export interface Fleet {
  at: number;
  rows: FleetRow[];
  concern: string | null;
}

export interface ChatTool {
  name: string;
  status: string;
  label: string;
  ok?: boolean;
  /** `send_task` : tâche destinataire et texte réellement envoyé (non tronqué). */
  taskId?: string;
  title?: string;
  text?: string;
}

export interface SupervisorMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  tools: ChatTool[];
}

export interface QueuedSupervisorMessage {
  id: string;
  text: string;
  at: number;
}

export interface SupervisorState {
  sessionId: string | null;
  status: 'idle' | 'busy' | 'unknown';
  agent: string | null;
  /** modèle effectif de la conversation (visible dans l'en-tête) */
  model?: SupervisorModelInfo | null;
  directory: string;
  mode: 'pilot' | 'investigation';
  projectDirectory: string | null;
  messages: SupervisorMessage[];
  queued: QueuedSupervisorMessage[];
  /** questions du tool `question` en attente de réponse */
  pendingForms: PendingForm[];
  error?: string;
}

export interface SupervisorModelInfo {
  ref: string;
  providerID: string;
  modelID: string;
  name: string;
}

/** `GET /api/supervisor/config` : catalogue et préférences du bouton config. */
export interface SupervisorModelOption {
  ref: string;
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
  context?: number;
}

export interface SupervisorAgentOption {
  id: string;
  name: string;
  description?: string;
}

export type SupervisorPrefField = 'chatModel' | 'chatAgent' | 'taskModel';

export interface SupervisorPrefs {
  chatModel: string | null;
  chatAgent: string | null;
  taskModel: string | null;
}

export interface SupervisorConfig {
  prefs: SupervisorPrefs;
  defaults: {
    chatAgent: null;
    chatAgentLabel: string;
    chatModel: string | null;
    taskModel: null;
    taskModelLabel: string;
  };
  models: SupervisorModelOption[];
  agents: SupervisorAgentOption[];
  updatedAt: number | null;
  /** préférences enregistrées devenues invalides (affichées à l'ouverture) */
  warnings?: SupervisorConfigWarning[];
}

export interface SupervisorConfigWarning {
  field: SupervisorPrefField;
  value: string;
  message: string;
}

/** Modèle propre à une tâche (`GET /api/fleet/model?sessionId=…`). */
export interface TaskModelInfo {
  sessionId: string;
  /** préférence de la tâche, null = défaut de la session */
  model: string | null;
  /** modèle réellement porté par la session */
  effective: string | null;
  /** nom lisible du modèle effectif, sinon de la préférence */
  name: string | null;
  models: SupervisorModelOption[];
  defaultModel: string | null;
}

export interface TaskModelSaveResult {
  ok: boolean;
  info?: TaskModelInfo;
  error?: 'invalid_model' | 'no_default' | 'apply_failed' | string;
  message?: string;
  /** false : appliqué à la session, mais aucun brief/registre à mettre à jour */
  persisted?: boolean;
}

export interface SupervisorProject {
  id: string;
  name: string;
  directory: string;
  lastUsedAt: number;
}

/** `GET /api/fleet/delivery?sessionId=…` : dernier résultat de l'agent. */
export interface DeliveryRender {
  html: string;
  title: string;
}

export interface Delivery {
  sessionId: string;
  at: number;
  state: 'ok' | 'empty' | 'unavailable';
  messageId?: string;
  createdAt?: number;
  turnStartedAt?: number;
  markdown?: string;
  render?: DeliveryRender;
  truncated?: boolean;
  error?: string;
}
