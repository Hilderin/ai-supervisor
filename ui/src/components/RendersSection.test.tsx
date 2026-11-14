import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskRender } from '../types';
import { RenderDialogPanel, RenderFrame, RendersSection, splitRenders } from './RendersSection';

const htmlRender: TaskRender = {
  id: 1,
  at: 1_700_000_000_000,
  title: 'Ventes par région',
  kind: 'html',
  content: '<h1>Ventes</h1><p>Résumé du mois.</p>',
};

describe('splitRenders', () => {
  test('les rendus non vus sortent du journal, les plus récents d’abord', () => {
    const renders: TaskRender[] = [
      { ...htmlRender, id: 1, at: 100 },
      { ...htmlRender, id: 2, at: 300, title: 'Deux' },
      { ...htmlRender, id: 3, at: 200, read_at: 400 },
    ];
    const { pending, seen } = splitRenders(renders);
    expect(pending.map((r) => r.id)).toEqual([2, 1]);
    expect(seen.map((r) => r.id)).toEqual([3]);
  });
});

describe('RendersSection (rendu statique : état initial)', () => {
  test('sans rendu connu : rien à afficher (section conditionnelle)', () => {
    const html = renderToStaticMarkup(<RendersSection sessionId="ses_r" refreshKey="0:0" />);
    expect(html).toBe('');
  });
});

describe('RenderFrame', () => {
  test('une page HTML passe par l’iframe sandboxée, jamais dans le DOM', () => {
    const html = renderToStaticMarkup(<RenderFrame render={htmlRender} />);
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('<h1>Ventes</h1>');
  });

  test('une page ui est dessinée par le parseur openui-lang', () => {
    const html = renderToStaticMarkup(
      <RenderFrame render={{ ...htmlRender, kind: 'ui', content: 'root = Stack([t])\nt = Text("Bonjour")' }} />,
    );
    expect(html).toContain('data-testid="render-ui-source"');
    expect(html).toContain('Bonjour');
  });
});

describe('RenderDialogPanel (popup agrandi)', () => {
  test('affiche le titre, le rendu et un bouton de fermeture', () => {
    const html = renderToStaticMarkup(<RenderDialogPanel render={htmlRender} onClose={() => {}} />);
    expect(html).toContain('data-testid="render-dialog"');
    expect(html).toContain('Ventes par région');
    expect(html).toContain('data-testid="render-dialog-close"');
    expect(html).toContain('<iframe');
  });
});
