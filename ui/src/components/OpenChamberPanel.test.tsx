import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenChamberPanel } from './OpenChamberPanel';

describe('OpenChamberPanel', () => {
  test('affiche le contexte de la session et un bouton X accessible', () => {
    const html = renderToStaticMarkup(
      <OpenChamberPanel
        sessionId="ses_task"
        sessionTitle="Vérifier un titre de tâche suffisamment long"
        onClose={() => {}}
      />,
    );

    expect(html).toContain('OpenChamber - Vérifier un titre de tâche suffisamment long');
    expect(html).toContain('class="min-w-0 flex-1 truncate');
    expect(html).toContain('aria-label="Fermer le panneau Mini Chat"');
    expect(html).toContain('×</span>');
  });
});
