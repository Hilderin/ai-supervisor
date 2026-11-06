import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliveryMarkdown } from './DeliveryMarkdown';

describe('DeliveryMarkdown', () => {
  test('rend les titres, listes, code et tableaux GFM', () => {
    const html = renderToStaticMarkup(
      <DeliveryMarkdown
        markdown={'# Titre\n\n- un\n- deux\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'}
      />,
    );
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
  });

  test('le HTML brut du message n’est pas interprété', () => {
    const html = renderToStaticMarkup(
      <DeliveryMarkdown markdown={'<script>alert(1)</script>\n\n<b>gras</b>'} />,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
  });

  test('les liens sortent dans un nouvel onglet', () => {
    const html = renderToStaticMarkup(<DeliveryMarkdown markdown={'[doc](https://example.com)'} />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });
});
