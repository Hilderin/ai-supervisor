import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanAssetSource, readSessionAsset } from '../src/assets.mts';

// PNG 1x1 transparent
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3yWQAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let outside = '';

beforeAll(async () => {
  const parent = await mkdtemp(join(tmpdir(), 'superviseur-assets-'));
  root = join(parent, 'session');
  outside = join(parent, 'outside.png');
  await mkdir(join(root, '.openchamber', 'screenshots'), { recursive: true });
  await writeFile(join(root, '.openchamber', 'screenshots', 'x.png'), PNG);
  await writeFile(join(root, 'note.txt'), 'pas une image');
  await writeFile(outside, PNG);
});

afterAll(async () => {
  await rm(join(root, '..'), { recursive: true, force: true });
});

describe('readSessionAsset', () => {
  test('sert une image relative au dossier de session', async () => {
    const r = await readSessionAsset(root, '.openchamber/screenshots/x.png');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type).toBe('image/png');
      expect(r.body.equals(PNG)).toBe(true);
    }
  });

  test('accepte un chemin absolu dans le dossier', async () => {
    const r = await readSessionAsset(root, join(root, '.openchamber', 'screenshots', 'x.png'));
    expect(r.ok).toBe(true);
  });

  test('accepte file:// et retire query/fragment', async () => {
    const r = await readSessionAsset(root, `file://${join(root, '.openchamber', 'screenshots', 'x.png')}?v=2#top`);
    expect(r.ok).toBe(true);
    expect(cleanAssetSource('a/b.png?x=1#y')).toBe('a/b.png');
  });

  test('refuse une traversée hors du dossier', async () => {
    const r = await readSessionAsset(root, '../outside.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test('refuse un chemin absolu hors du dossier', async () => {
    const r = await readSessionAsset(root, outside);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  test('refuse un fichier non image', async () => {
    const r = await readSessionAsset(root, 'note.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  test('image absente : 404', async () => {
    const r = await readSessionAsset(root, 'absente.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});
