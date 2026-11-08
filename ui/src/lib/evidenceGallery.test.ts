/**
 * Tests du lot de captures et de la navigation de la visionneuse : la même
 * fonction sert aux boutons et au clavier, d'où le test des bornes ici.
 */
import { describe, expect, test } from 'bun:test';
import type { Criterion } from '../types';
import {
  clampIndex,
  collectEvidenceImages,
  evidenceAssetUrl,
  galleryIndex,
  stepIndex,
} from './evidenceGallery';

function criterion(patch: Partial<Criterion> & Pick<Criterion, 'id' | 'ref'>): Criterion {
  return {
    task_id: 's1',
    title: `Titre ${patch.ref}`,
    detail: null,
    methods: ['screenshot'],
    status: 'to_validate',
    evidence: [],
    review: null,
    review_at: null,
    created_at: 1,
    updated_at: 1,
    ...patch,
  };
}

const rows: Criterion[] = [
  criterion({
    id: 1,
    ref: 'AC-01',
    evidence: [
      { kind: 'screenshot', text: 'première', path: 'docs/a.jpg', at: 1 },
      { kind: 'unit_test', text: '12 pass', at: 2 },
      { kind: 'screenshot', text: 'sans chemin', at: 3 },
    ],
  }),
  criterion({
    id: 2,
    ref: 'AC-02',
    evidence: [
      { kind: 'screenshot', text: 'deuxième', path: 'docs/b.jpg', at: 4 },
      { kind: 'screenshot', text: 'même fichier, autre critère', path: 'docs/a.jpg', at: 5 },
    ],
  }),
];

describe('collectEvidenceImages', () => {
  test('ne garde que les captures portant un chemin, dans l’ordre des critères puis des preuves', () => {
    const images = collectEvidenceImages(rows, 'ses_1');
    expect(images.map((im) => im.text)).toEqual(['première', 'deuxième', 'même fichier, autre critère']);
    expect(images.map((im) => im.ref)).toEqual(['AC-01', 'AC-02', 'AC-02']);
  });

  test('un même fichier cité par deux critères reste deux entrées (le critère fait partie de l’image)', () => {
    const images = collectEvidenceImages(rows, 'ses_1');
    expect(images.filter((im) => im.path === 'docs/a.jpg')).toHaveLength(2);
    expect(images[0].key).not.toBe(images[2].key);
  });

  test('l’URL sert le fichier par la route d’asset, chemin et session échappés', () => {
    const [first] = collectEvidenceImages(rows, 'ses_1');
    expect(first.src).toBe('/api/fleet/asset?sessionId=ses_1&path=docs%2Fa.jpg');
    expect(evidenceAssetUrl('ses 1', 'docs/é.jpg')).toContain('path=docs%2F%C3%A9.jpg');
    expect(evidenceAssetUrl('ses 1', 'docs/é.jpg')).toContain('sessionId=ses%201');
  });

  test('le rang d’une preuve se retrouve par critère et index de preuve', () => {
    const images = collectEvidenceImages(rows, 'ses_1');
    expect(galleryIndex(images, 2, 1)).toBe(2);
    expect(galleryIndex(images, 2, 2)).toBe(-1);
    expect(galleryIndex(images, 99, 0)).toBe(-1);
  });

  test('une liste de preuves vide donne un lot vide', () => {
    expect(collectEvidenceImages([], 's1')).toEqual([]);
    expect(collectEvidenceImages([criterion({ id: 3, ref: 'AC-03' })], 's1')).toEqual([]);
  });
});

describe('navigation de la galerie', () => {
  test('l’index est borné au lot, même après un rechargement plus court', () => {
    expect(clampIndex(0, 3)).toBe(0);
    expect(clampIndex(2, 3)).toBe(2);
    expect(clampIndex(9, 3)).toBe(2);
    expect(clampIndex(-4, 3)).toBe(0);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(clampIndex(1, 0)).toBe(-1);
  });

  test('pas de bouclage : aux extrémités le voisin n’existe pas', () => {
    expect(stepIndex(0, -1, 3)).toBeNull();
    expect(stepIndex(3, 1, 3)).toBeNull();
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, -1, 3)).toBe(1);
  });

  test('les boutons et les flèches partagent la même fonction : gauche puis droite revient au départ', () => {
    const start = 1;
    const left = stepIndex(start, -1, 3);
    const right = left == null ? null : stepIndex(left, 1, 3);
    expect(left).toBe(0);
    expect(right).toBe(1);
  });
});
