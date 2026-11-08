import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormField, PendingForm } from '../types';
import { OTHER } from '../lib/answer';
import { QuestionBox, QuestionField } from './QuestionBox';

const field: FormField = {
  key: 'q0',
  title: 'Quelle version ?',
  type: 'string',
  options: [
    { value: 'bun', label: 'Bun' },
    { value: 'node', label: 'Node' },
  ],
};

function renderField(picked: string | string[] | undefined, text: string): string {
  return renderToStaticMarkup(
    <QuestionField
      field={field}
      picked={picked}
      text={text}
      onSelect={() => {}}
      onText={() => {}}
      onSubmit={() => {}}
    />,
  );
}

function form(fields: FormField[]): PendingForm {
  return { id: 'form_1', title: 'Question', fields };
}

describe('QuestionBox', () => {
  test('propose un choix « Autre » associé au champ de texte libre', () => {
    const html = renderToStaticMarkup(<QuestionBox sessionId="ses_test" form={form([field])} />);
    expect(html).toContain('data-testid="question-other"');
    expect(html).toContain('Autre');
    expect(html).toContain('data-testid="question-free"');
    expect(html).toContain('Bun');
    expect(html).toContain('Node');
  });

  test('une question sans options garde son seul champ de texte, sans bouton « Autre »', () => {
    const html = renderToStaticMarkup(
      <QuestionBox sessionId="ses_test" form={form([{ key: 'q0', title: 'Ton nom ?' }])} />,
    );
    expect(html).toContain('data-testid="question-free"');
    expect(html).not.toContain('data-testid="question-other"');
  });

  test('sans réponse, « Répondre » est désactivé', () => {
    const html = renderToStaticMarkup(<QuestionBox sessionId="ses_test" form={form([field])} />);
    expect(html).toContain('Répondre');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Répondre<\/button>/);
  });
});

describe('QuestionField', () => {
  test('sans texte, « Autre » n’est pas actif et aucun blocage n’est affiché', () => {
    const html = renderField(undefined, '');
    expect(html).toMatch(/data-testid="question-other"[^>]*aria-pressed="false"/);
    expect(html).not.toContain('data-testid="question-other-missing"');
  });

  test('« Autre » actif avec un texte : actif, champ vert, aucun blocage', () => {
    const html = renderField(OTHER, 'mon texte');
    expect(html).toMatch(/data-testid="question-other"[^>]*aria-pressed="true"/);
    expect(html).toContain('border-color:var(--color-green)');
    expect(html).not.toContain('data-testid="question-other-missing"');
  });

  test('« Autre » actif sans texte : blocage visible, champ en alerte', () => {
    const html = renderField(OTHER, '');
    expect(html).toContain('data-testid="question-other-missing"');
    expect(html).toContain('Saisis un texte pour « Autre », ou choisis une option.');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-color:var(--color-danger)');
    expect(html).toContain('value=""');
  });

  test('« Autre » actif avec des espaces seulement : blocage aussi', () => {
    const html = renderField(OTHER, '   ');
    expect(html).toContain('data-testid="question-other-missing"');
    expect(html).toContain('aria-invalid="true"');
  });

  test('une option choisie avec du texte fantôme : l’option est active, le texte disparaît', () => {
    const html = renderField('bun', '');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Bun</);
    expect(html).toMatch(/data-testid="question-other"[^>]*aria-pressed="false"/);
    expect(html).not.toContain('data-testid="question-other-missing"');
  });
});
