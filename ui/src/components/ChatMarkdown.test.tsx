import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from './ChatMarkdown';

const draw = (text: string) => renderToStaticMarkup(<ChatMarkdown text={text} />);

describe('ChatMarkdown', () => {
  test('rend les titres, listes, code, tableaux GFM et liens sûrs', () => {
    const html = draw(
      '# Titre\n\n- un\n- deux\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n[doc](https://example.com)',
    );
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
    expect(html).toContain('<table>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  test('le HTML brut du message n’est pas interprété', () => {
    const html = draw('<script>alert(1)</script>\n\n<b>gras</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
  });

  test('les images ne sont pas affichées dans le chat', () => {
    const html = draw('![capture](.openchamber/screenshots/x.jpg)');
    expect(html).not.toContain('<img');
  });

  test('dessine un fence openui-lang valide au lieu de le laisser en code', () => {
    const html = draw(
      'Voici le parcours :\n\n```openui-lang\nroot = Stack([flow])\nflow = Steps([{title: "Cadrer", status: "done"}, {title: "Coder", status: "current"}])\n```\n\nLa suite ensuite.',
    );
    expect(html).toContain('data-testid="ui-block"');
    expect(html).toContain('Cadrer');
    expect(html).toContain('Coder');
    expect(html).toContain('La suite ensuite.');
  });

  test('accepte la balise <openui-lang> comme le chat OpenChamber', () => {
    const html = draw(
      '<openui-lang>\nroot = Stack([c])\nc = Callout("Le build est vert.", "success")\n</openui-lang>',
    );
    expect(html).toContain('data-testid="ui-block"');
    expect(html).toContain('Le build est vert.');
  });

  test('pendant le streaming, un bloc incomplet reste en code brut', () => {
    const html = draw('```openui-lang\nroot = Stack([a])\na = Steps([{title: "Cadrer"');
    expect(html).toContain('data-testid="ui-block-raw"');
    expect(html).toContain('Cadrer');
    expect(html).not.toContain('data-testid="ui-block"');
  });

  test('un bloc invalide complet reste lisible en code', () => {
    const html = draw('```openui-lang\nroot = Stack([a])\na = Steps([{title: "Cassé"\n```');
    expect(html).toContain('data-testid="ui-block-raw"');
    expect(html).toContain('Cassé');
  });
});
