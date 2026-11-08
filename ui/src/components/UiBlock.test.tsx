import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { UiBlock } from './UiBlock';

const draw = (source: string) => renderToStaticMarkup(<UiBlock source={source} />);

describe('UiBlock : blocs openui-lang', () => {
  test('dessine un parcours d’étapes avec ses statuts', () => {
    const html = draw(
      'root = Stack([flow])\nflow = Steps([{title: "Cadrer", status: "done"}, {title: "Coder", status: "current"}, {title: "Livrer"}], "column")',
    );
    expect(html).toContain('data-testid="ui-block"');
    expect(html).toContain('Cadrer');
    expect(html).toContain('Coder');
    expect(html).toContain('Livrer');
    expect(html).toContain('role="list"');
    expect(html).not.toContain('ui-block-raw');
  });

  test('dessine un tableau avec ses en-têtes et ses valeurs', () => {
    const html = draw(
      'root = Stack([t])\nt = Table(["Étape", "Durée"], [["Analyse", 2], ["Build", 5]])',
    );
    expect(html).toContain('data-testid="ui-block"');
    expect(html).toContain('<table>');
    expect(html).toContain('Analyse');
    expect(html).toContain('Durée');
  });

  test('dessine un encadré avec son titre et son markdown', () => {
    const html = draw(
      'root = Stack([c])\nc = Callout("Le build est **vert**.", "success", "Vérification")',
    );
    expect(html).toContain('data-testid="ui-block"');
    expect(html).toContain('Vérification');
    expect(html).toContain('<strong>vert</strong>');
  });

  test('un bloc invalide retombe en code brut, jamais en vide', () => {
    const source = 'root = Stack([a])\na = Steps([{title: "Cassé"';
    const html = draw(source);
    expect(html).toContain('data-testid="ui-block-raw"');
    expect(html).toContain('Steps');
    expect(html).not.toContain('data-testid="ui-block"');
  });

  test('un composant non dessiné retombe en code brut', () => {
    const source = 'root = Stack([c])\nc = BarChart(["a", "b"], [Series("x", [1, 2])])';
    const html = draw(source);
    expect(html).toContain('data-testid="ui-block-raw"');
    expect(html).toContain('BarChart');
  });

  test('un composant interactif ne dessine pas un formulaire mort', () => {
    const source = 'root = Stack([c])\nc = Choice("suite", ["Lancer", "Attendre"], "Quelle suite ?")';
    const html = draw(source);
    expect(html).toContain('data-testid="ui-block-raw"');
    expect(html).toContain('Choice');
  });
});
