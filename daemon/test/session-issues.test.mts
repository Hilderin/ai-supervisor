import { describe, expect, test } from 'bun:test';
import { SessionIssueTracker } from '../src/session-issues.mts';

describe('SessionIssueTracker', () => {
  test('conserve l’échec, puis le remplace par le retry planifié', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({
      type: 'session.execution.failed',
      data: { sessionID: 'ses_a', error: { type: 'ProviderError', message: 'limite atteinte', status: 429 } },
    }, 100);
    expect(tracker.get('ses_a')).toEqual({
      state: 'error', message: 'limite atteinte', errorType: 'ProviderError', errorStatus: 429, updatedAt: 100,
    });

    tracker.ingest({
      type: 'session.retry.scheduled',
      data: { sessionID: 'ses_a', attempt: 2, at: 200, error: { type: 'ProviderError', message: 'limite atteinte', status: 429 } },
    }, 110);
    expect(tracker.get('ses_a')).toEqual({
      state: 'retry', message: 'limite atteinte', errorType: 'ProviderError', errorStatus: 429, attempt: 2, updatedAt: 110,
    });
  });

  test.each([
    'session.execution.started',
    'session.execution.succeeded',
    'session.execution.interrupted',
    'session.inbox.enqueued',
  ])('%s efface l’erreur périmée', (type) => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({ type: 'session.execution.failed', data: { sessionID: 'ses_a', error: { message: 'échec' } } });
    tracker.ingest({ type, data: { sessionID: 'ses_a' } });
    expect(tracker.get('ses_a')).toBeUndefined();
  });

  test('les événements sans session ou les autres sessions ne modifient pas cet état', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({ type: 'session.retry.scheduled', data: { sessionID: 'ses_a', attempt: 1 } });
    tracker.ingest({ type: 'session.execution.succeeded', data: { sessionID: 'ses_b' } });
    tracker.ingest({ type: 'session.execution.failed', data: { error: { message: 'incomplet' } } });
    expect(tracker.get('ses_a')?.state).toBe('retry');
    expect(tracker.get('ses_b')).toBeUndefined();
  });
});
