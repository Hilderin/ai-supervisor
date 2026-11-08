/** Contrat de données du daemon (`GET /api/fleet`, SSE `/api/fleet/stream`). */

export type VerdictState = 'working' | 'waiting_human' | 'done' | 'blocked';
export type HumanSource = 'question_tool' | 'permission' | 'agent_ask' | 'none';

export interface Verdict {
  resume?: string;
  progress?: number | null;
  termine?: boolean;
  attend?: string;
  at?: number;
  state?: VerdictState;
  humanSource?: HumanSource;
  next?: string;
}

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
  metadata?: { kind?: string };
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
}

export interface CriteriaCounts {
  total: number;
  todo: number;
  toValidate: number;
  toFix: number;
  validated: number;
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
    updatedAt: number;
  };
  dir?: string;
  sup?: Verdict;
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
  directory: string;
  mode: 'pilot' | 'investigation';
  projectDirectory: string | null;
  messages: SupervisorMessage[];
  queued: QueuedSupervisorMessage[];
  error?: string;
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
