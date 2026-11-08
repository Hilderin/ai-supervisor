/**
 * Tests de la visionneuse de preuves (contenu rendu hors portail : le portail
 * n'existe pas au rendu statique). Les gestes (Échap, flèches, clic hors image)
 * sont vérifiés au navigateur ; ici on fige le contrat visuel et les bornes.
 */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GalleryImage } from '../lib/evidenceGallery';
import { EvidenceViewerPanel } from './EvidenceViewer';

const images: GalleryImage[] = [
  {
    key: '1:0', criterionId: 1, evidenceIndex: 0,
    ref: 'AC-01', title: 'Capture du formulaire', text: 'Option choisie et texte libre.',
    path: 'docs/a.jpg', src: '/api/fleet/asset?sessionId=s1&path=docs%2Fa.jpg', alt: 'Option choisie',
  },
  {
    key: '2:0', criterionId: 2, evidenceIndex: 0,
    ref: 'AC-02', title: 'Second état', text: 'Champ vide bloqué.',
    path: 'docs/b.jpg', src: '/api/fleet/asset?sessionId=s1&path=docs%2Fb.jpg', alt: 'Champ vide',
  },
  {
    key: '2:1', criterionId: 2, evidenceIndex: 1,
    ref: 'AC-02', title: 'Second état', text: 'État soumis.',
    path: 'docs/c.jpg', src: '/api/fleet/asset?sessionId=s1&path=docs%2Fc.jpg', alt: 'État soumis',
  },
];

function render(index: number): string {
  return renderToStaticMarkup(
    createElement(EvidenceViewerPanel, {
      image: images[index],
      index,
      total: images.length,
      onIndex: () => {},
      onClose: () => {},
      onBackdrop: () => {},
    }),
  );
}

describe('EvidenceViewerPanel', () => {
  test('affiche l’image entière, sans déformation, et son texte', () => {
    const html = render(0);
    expect(html).toContain('data-testid="evidence-viewer-image"');
    expect(html).toContain('object-contain');
    expect(html).toContain('max-h-full');
    expect(html).toContain('Option choisie et texte libre.');
    expect(html).toContain('src="/api/fleet/asset?sessionId=s1&amp;path=docs%2Fa.jpg"');
  });

  test('le critère d’origine et la position dans le lot sont discrets et présents', () => {
    const html = render(1);
    expect(html).toContain('AC-02');
    expect(html).toContain('Second état');
    expect(html).toContain('2 / 3');
  });

  test('sur la première image, précédent est désactivé ; suivant reste actif', () => {
    const html = render(0);
    expect(html).toMatch(/data-testid="evidence-viewer-prev"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="evidence-viewer-next"[^>]*disabled=""/);
  });

  test('sur la dernière image, suivant est désactivé (pas de bouclage)', () => {
    const html = render(2);
    expect(html).toMatch(/data-testid="evidence-viewer-next"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="evidence-viewer-prev"[^>]*disabled=""/);
    expect(html).toContain('3 / 3');
  });

  test('au milieu, les deux boutons sont actifs', () => {
    const html = render(1);
    expect(html).not.toMatch(/data-testid="evidence-viewer-prev"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="evidence-viewer-next"[^>]*disabled=""/);
  });

  test('la fermeture a un bouton nommé accessible', () => {
    const html = render(0);
    expect(html).toContain('data-testid="evidence-viewer-close"');
    expect(html).toContain('aria-label="Fermer la visionneuse"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  test('les deux boutons annoncent leur geste clavier', () => {
    const html = render(1);
    expect(html).toContain('Image précédente (flèche gauche)');
    expect(html).toContain('Image suivante (flèche droite)');
  });
});
