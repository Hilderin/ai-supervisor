/** Dernier état d'erreur ou de retry reçu du flux d'événements OpenCode. */
export interface SessionIssue {
  state: 'error' | 'retry';
  message?: string;
  errorType?: string;
  errorStatus?: number;
  attempt?: number;
  /** Début prévu de la tentative relancée (epoch ms, champ `at` de l'événement). */
  retryAt?: number;
  updatedAt: number;
}

export interface SessionIssueEvent {
  type?: string;
  data?: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorFields(data: Record<string, unknown>) {
  const error = record(data.error);
  const status = error?.status;
  return {
    message: text(error?.message),
    errorType: text(error?.type),
    errorStatus: typeof status === 'number' && Number.isFinite(status) ? status : undefined,
  };
}

/**
 * L'endpoint status ne donne que idle/busy. Ces événements complètent son état :
 * failed → error, retry.scheduled → retry, puis started/succeeded/interrupted
 * ou un nouveau prompt effacent l'information devenue périmée.
 *
 * Un retry n'émet PAS de `session.execution.started` quand la tentative reprend :
 * cet événement marque le début du tour, pas de chaque tentative. Sans son
 * échéance, « Nouvel essai » restait affiché pendant tout le travail rattrapé et
 * ne disparaissait qu'à la fin du tour (constaté le 2026-11-08 : rate limit
 * dépassé, session productive pendant plusieurs minutes, bandeau toujours là).
 * Le champ `at` de l'événement donne l'heure de reprise : passé ce délai, le
 * signal est périmé et la ligne d'activité reprend la main.
 */
export class SessionIssueTracker {
  private readonly issues = new Map<string, SessionIssue>();

  ingest(event: SessionIssueEvent, now = Date.now()): void {
    const type = String(event.type ?? '');
    const data = event.data ?? {};
    const sessionId = text(data.sessionID);
    if (!sessionId) return;

    if (type === 'session.execution.failed') {
      this.issues.set(sessionId, {
        state: 'error',
        ...errorFields(data),
        updatedAt: now,
      });
      return;
    }

    if (type === 'session.retry.scheduled') {
      const attempt = data.attempt;
      const retryAt = data.at;
      this.issues.set(sessionId, {
        state: 'retry',
        ...errorFields(data),
        attempt: typeof attempt === 'number' && Number.isFinite(attempt) ? attempt : undefined,
        retryAt: typeof retryAt === 'number' && Number.isFinite(retryAt) ? retryAt : undefined,
        updatedAt: now,
      });
      return;
    }

    if (
      type === 'session.execution.started' ||
      type === 'session.execution.succeeded' ||
      type === 'session.execution.interrupted' ||
      type === 'session.inbox.enqueued'
    ) {
      this.issues.delete(sessionId);
    }
  }

  get(sessionId: string, now = Date.now()): SessionIssue | undefined {
    const issue = this.issues.get(sessionId);
    if (!issue) return undefined;
    if (issue.state === 'retry' && issue.retryAt !== undefined && now >= issue.retryAt) {
      this.issues.delete(sessionId);
      return undefined;
    }
    return issue;
  }
}
