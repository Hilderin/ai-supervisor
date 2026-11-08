import { describe, expect, test } from 'bun:test';
import { SessionIssueTracker } from '../src/session-issues.mts';

describe('SessionIssueTracker', () => {
  test('conserve l’échec, puis le remplace par le retry planifié', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({
      type: 'session.execution.failed',
      data: { sessionID: 'ses_a', error: { type: 'ProviderError', message: 'limite atteinte', status: 429 } },
    }, 100);
    expect(tracker.get('ses_a', 150)).toEqual({
      state: 'error', message: 'limite atteinte', errorType: 'ProviderError', errorStatus: 429, updatedAt: 100,
    });

    tracker.ingest({
      type: 'session.retry.scheduled',
      data: { sessionID: 'ses_a', attempt: 2, at: 200, error: { type: 'ProviderError', message: 'limite atteinte', status: 429 } },
    }, 110);
    expect(tracker.get('ses_a', 150)).toEqual({
      state: 'retry',
      message: 'limite atteinte',
      errorType: 'ProviderError',
      errorStatus: 429,
      attempt: 2,
      retryAt: 200,
      updatedAt: 110,
    });
  });

  test('le retry s’efface à l’heure de reprise, sans attendre la fin du tour', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({
      type: 'session.retry.scheduled',
      data: { sessionID: 'ses_a', attempt: 2, at: 5_000, error: { message: 'Rate limit' } },
    }, 1_000);

    expect(tracker.get('ses_a', 4_999)?.state).toBe('retry');
    // la tentative a repris : OpenCode n’émet pas execution.started pour elle
    expect(tracker.get('ses_a', 5_000)).toBeUndefined();
    // et l’effacement est durable, pas seulement à l’instant exact
    expect(tracker.get('ses_a', 9_000)).toBeUndefined();
  });

  test('un nouvel échec repousse l’échéance du retry affiché', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({ type: 'session.retry.scheduled', data: { sessionID: 'ses_a', attempt: 1, at: 5_000 } }, 1_000);
    tracker.ingest(
      { type: 'session.retry.scheduled', data: { sessionID: 'ses_a', attempt: 2, at: 20_000, error: { message: 'encore' } } },
      6_000,
    );
    expect(tracker.get('ses_a', 10_000)).toMatchObject({ state: 'retry', attempt: 2, retryAt: 20_000 });
    expect(tracker.get('ses_a', 20_000)).toBeUndefined();
  });

  test('sans échéance, le retry reste jusqu’au prochain événement de tour', () => {
    const tracker = new SessionIssueTracker();
    tracker.ingest({ type: 'session.retry.scheduled', data: { sessionID: 'ses_a', attempt: 1 } }, 1_000);
    expect(tracker.get('ses_a', 999_000)?.state).toBe('retry');
    tracker.ingest({ type: 'session.execution.succeeded', data: { sessionID: 'ses_a' } }, 1_000_000);
    expect(tracker.get('ses_a', 1_000_001)).toBeUndefined();
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
