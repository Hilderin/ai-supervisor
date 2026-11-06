/** Contrat de données du daemon (`GET /api/fleet`, SSE `/api/fleet/stream`). */

export interface Verdict {
  resume?: string;
  confiance?: number;
  progress?: number;
  termine?: boolean;
  attend?: string;
  note?: string;
  at?: number;
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
}

export interface Fleet {
  at: number;
  rows: FleetRow[];
  concern: string | null;
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
