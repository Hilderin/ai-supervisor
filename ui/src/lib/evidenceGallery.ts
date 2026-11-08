import type { Criterion } from '../types';

/** Une capture de preuve, à sa place dans le lot de la tâche. */
export interface GalleryImage {
  /** identité stable : critère + rang de la preuve dans ce critère */
  key: string;
  criterionId: number;
  evidenceIndex: number;
  /** référence et titre du critère d'origine, affichés discrètement */
  ref: string;
  title: string;
  /** commentaire saisi avec la preuve */
  text: string;
  path: string;
  src: string;
  alt: string;
}

/** URL de service d'une image locale du projet (même route que la livraison). */
export function evidenceAssetUrl(sessionId: string, path: string): string {
  return `/api/fleet/asset?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`;
}

/**
 * Lot des captures d'une tâche : tous les critères, dans l'ordre affiché, et
 * dans chaque critère l'ordre des preuves. Un même fichier cité par deux
 * critères reste deux entrées (le critère d'origine fait partie de l'image).
 * Seules les preuves `screenshot` portant un chemin sont des images.
 */
export function collectEvidenceImages(criteria: Criterion[], sessionId: string): GalleryImage[] {
  const images: GalleryImage[] = [];
  for (const criterion of criteria) {
    criterion.evidence.forEach((ev, evidenceIndex) => {
      if (ev.kind !== 'screenshot' || !ev.path) return;
      const text = (ev.text ?? '').trim();
      images.push({
        key: `${criterion.id}:${evidenceIndex}`,
        criterionId: criterion.id,
        evidenceIndex,
        ref: criterion.ref,
        title: criterion.title,
        text,
        path: ev.path,
        src: evidenceAssetUrl(sessionId, ev.path),
        alt: text || `Capture de preuve ${criterion.ref}`,
      });
    });
  }
  return images;
}

/** Rang d'une capture dans le lot, -1 si elle n'y est pas (liste rechargée). */
export function galleryIndex(images: GalleryImage[], criterionId: number, evidenceIndex: number): number {
  return images.findIndex((im) => im.criterionId === criterionId && im.evidenceIndex === evidenceIndex);
}

/** Index borné : la visionneuse ne sort jamais du lot, même après un rechargement. */
export function clampIndex(index: number, total: number): number {
  if (total <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), total - 1);
}

/**
 * Voisin à `delta` pas, borné : aux extrémités on reste sur place, on ne boucle
 * pas. Renvoie null quand il n'y a pas de voisin (bouton désactivé).
 */
export function stepIndex(index: number, delta: number, total: number): number | null {
  const current = clampIndex(index, total);
  if (current < 0) return null;
  const next = current + delta;
  if (next < 0 || next >= total) return null;
  return next;
}
