/** Contrat de données du daemon (`GET /api/fleet`, SSE `/api/fleet/stream`). */

export type VerdictState = 'working' | 'waiting_human' | 'done' | 'blocked';
export type HumanSource = 'question_tool' | 'permission' | 'agent_ask' | 'none';

export interface Verdict {
  resume?: string;
  confiance?: number | null;
  progress?: number | null;
  termine?: boolean;
  attend?: string;
  note?: string;
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

export interface FleetRow {
  id: string;
  title: string;
  status: string;
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
  /** plan de la session de travail (`todowrite`) */
  todo?: { done: number; total: number };
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
}

export interface SupervisorMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  text: string;
  tools: ChatTool[];
}

export interface SupervisorState {
  sessionId: string | null;
  status: 'idle' | 'busy' | 'unknown';
  agent: string | null;
  directory: string;
  messages: SupervisorMessage[];
  error?: string;
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
