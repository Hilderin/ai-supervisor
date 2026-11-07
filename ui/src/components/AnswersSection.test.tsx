import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskAnswer } from '../types';
import { AnswersSection, splitAnswers } from './AnswersSection';

const base = { id: 1, at: 1_700_000_000_000, text: 'Voici la réponse.' };

describe('splitAnswers', () => {
  test('les réponses non lues sont visibles, les lues vont au journal', () => {
    const answers: TaskAnswer[] = [
      { ...base, id: 1 },
      { ...base, id: 2, question: 'Quelle version ?' },
      { ...base, id: 3, read_at: 1_700_000_100_000 },
    ];
    const { pending, hidden } = splitAnswers(answers);
    expect(pending.map((a) => a.id)).toEqual([1, 2]);
    expect(hidden.map((a) => a.id)).toEqual([3]);
  });
});

describe('AnswersSection (rendu statique : état initial)', () => {
  test('sans réponse(connue) : rien à afficher', () => {
    const html = renderToStaticMarkup(
      <AnswersSection sessionId="ses_a" refreshKey="0:0" />,
    );
    expect(html).toBe('');
  });
});
