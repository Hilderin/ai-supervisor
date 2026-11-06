/**
 * Fichiers d'image référencés par une réponse agent (captures, graphiques).
 *
 * L'UI du Superviseur est servie par le daemon (127.0.0.1:5180), pas par
 * OpenChamber : un chemin local du markdown (`.openchamber/screenshots/x.jpg`)
 * ne peut donc pas être chargé directement par le navigateur. Le daemon sert
 * l'image depuis le dossier de la session, avec validation stricte :
 * - chemin résolu dans le dossier de la session (symlinks compris) ;
 * - uniquement les formats raster que le navigateur affiche sans script ;
 * - taille bornée.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, sep } from 'node:path';

const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export type AssetResult =
  | { ok: true; body: Buffer; type: string }
  | { ok: false; status: number; error: string };

/** Nettoie une source markdown : file://, query et fragment. */
export function cleanAssetSource(source: string): string {
  let value = source.trim();
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = url.pathname;
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    } catch { return ''; }
  }
  return value.split(/[?#]/, 1)[0] ?? '';
}

/**
 * Lit une image du dossier de session. `source` peut être relative au dossier
 * ou absolue, mais doit rester sous le dossier réel de la session.
 */
export async function readSessionAsset(directory: string, source: string): Promise<AssetResult> {
  if (!directory) return { ok: false, status: 404, error: 'dossier de session inconnu' };
  const cleaned = cleanAssetSource(source);
  if (!cleaned) return { ok: false, status: 400, error: 'source vide' };

  let root: string;
  try { root = await realpath(directory); } catch { return { ok: false, status: 404, error: 'dossier introuvable' }; }

  const candidate = isAbsolute(cleaned) ? cleaned : join(root, cleaned);
  let real: string;
  try { real = await realpath(candidate); } catch { return { ok: false, status: 404, error: 'image introuvable' }; }

  if (real !== root && !real.startsWith(root + sep)) {
    return { ok: false, status: 403, error: 'image hors du dossier de session' };
  }

  const type = IMAGE_MIME[extname(real).toLowerCase()];
  if (!type) return { ok: false, status: 415, error: 'format d’image non pris en charge' };

  try {
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, status: 404, error: 'image introuvable' };
    if (info.size > MAX_ASSET_BYTES) return { ok: false, status: 413, error: 'image trop lourde' };
    return { ok: true, body: await readFile(real), type };
  } catch {
    return { ok: false, status: 404, error: 'image introuvable' };
  }
}
