/**
 * Citations des pièces jointes dans le brouillon, alignées sur OpenChamber :
 * une image collée reçoit un nom unique (`image-1.png`, `image-2.png`, ...)
 * et le texte du message porte `[image-1.png]`, exactement le nom de la
 * pièce jointe transmise. Un fichier nommé garde son nom (`[capture.png]`).
 *
 * Module pur : la génération des noms, le texte de citation et les espaces
 * d'insertion se testent sans navigateur.
 */

const GENERIC_IMAGE_BASENAMES = new Set([
  'image', 'screenshot', 'screen-shot', 'clipboard', 'pasted-image',
  'pastedimage', 'untitled', 'unknown', 'file', 'blob',
]);

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
};

const normalizeFilenameKey = (filename: string): string => filename.trim().toLowerCase();

const isUnsafeFilenameChar = (char: string): boolean => (
  char.charCodeAt(0) < 32 || '<>:"/\\|?*[]'.includes(char)
);

/** Nom sûr pour une citation `[nom]` : pas de crochets, de slash ni de contrôle. */
export function sanitizeAttachmentFilename(name: string): string {
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? '';
  return Array.from(basename)
    .map((char) => (isUnsafeFilenameChar(char) ? '-' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
}

function mimeExtension(mimeType?: string): string {
  const normalized = mimeType?.trim().toLowerCase() ?? '';
  return IMAGE_MIME_EXTENSIONS[normalized] ?? 'png';
}

function splitImageFilename(candidate: { name: string; type?: string }): { base: string; ext: string } {
  const clean = sanitizeAttachmentFilename(candidate.name);
  const fallbackExt = mimeExtension(candidate.type);
  const lastDot = clean.lastIndexOf('.');
  if (lastDot > 0 && lastDot < clean.length - 1) {
    const rawExt = clean.slice(lastDot + 1).toLowerCase();
    if (/^[a-z0-9]{1,10}$/.test(rawExt)) {
      return { base: clean.slice(0, lastDot).trim() || 'image', ext: rawExt };
    }
  }
  return { base: clean.trim() || 'image', ext: fallbackExt };
}

/** `image.png`, `Screenshot (1).png`, `blob` : un nom générique, donc numéroté. */
export function isGenericImageFilename(filename: string): boolean {
  const { base } = splitImageFilename({ name: filename });
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (GENERIC_IMAGE_BASENAMES.has(normalized)) return true;
  const withoutCopyCounter = normalized.replace(/-\(\d+\)$/g, '');
  if (withoutCopyCounter !== normalized && GENERIC_IMAGE_BASENAMES.has(withoutCopyCounter)) return true;
  return /^(image|file|unknown|untitled|blob)-\d+$/.test(normalized);
}

const withExtension = (base: string, ext: string): string => `${base}.${ext}`;

function nextUniqueFilename(base: string, ext: string, used: Set<string>): string {
  const first = withExtension(base, ext);
  if (!used.has(normalizeFilenameKey(first))) return first;
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = withExtension(`${base}-${index}`, ext);
    if (!used.has(normalizeFilenameKey(candidate))) return candidate;
  }
  return withExtension(`${base}-${Date.now()}`, ext);
}

function nextGeneratedImageFilename(ext: string, used: Set<string>): string {
  for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = withExtension(`image-${index}`, ext);
    const baseTaken = Array.from(used).some((filename) => filename.startsWith(`image-${index}.`));
    if (!baseTaken && !used.has(normalizeFilenameKey(candidate))) return candidate;
  }
  return withExtension(`image-${Date.now()}`, ext);
}

/**
 * Noms à donner aux images collées, dans l'ordre. Les noms génériques sont
 * numérotés à partir du premier libre ; un nom explicite est conservé, suffixé
 * `-2`, `-3` seulement en cas de collision.
 */
export function assignImageCitationNames(
  files: Array<{ name: string; type?: string }>,
  existingFilenames: string[],
): string[] {
  const used = new Set(existingFilenames.map(normalizeFilenameKey));
  return files.map((file) => {
    const { base, ext } = splitImageFilename(file);
    const filename = isGenericImageFilename(withExtension(base, ext))
      ? nextGeneratedImageFilename(ext, used)
      : nextUniqueFilename(base, ext, used);
    used.add(normalizeFilenameKey(filename));
    return filename;
  });
}

/** `['image-1.png','note.txt']` → `'[image-1.png] [note.txt]'`. */
export function buildAttachmentCitationText(filenames: string[]): string {
  return filenames.map((filename) => `[${filename}]`).join(' ');
}

/** La pièce jointe porte le nom que sa citation utilise. */
export function renameFileForCitation(file: File, filename: string): File {
  if (file.name === filename) return file;
  return new File([file], filename, { type: file.type, lastModified: file.lastModified });
}

/** Noms entre crochets déjà présents dans le texte (les liens markdown `[x](…)` sont exclus). */
export function citationNamesInText(text: string): string[] {
  if (!text || !text.includes('[')) return [];
  const names = new Set<string>();
  for (const match of text.matchAll(/\[([^[\]\n]+)\](?!\()/g)) {
    const name = match[1].trim();
    if (name) names.add(name);
  }
  return Array.from(names);
}

/**
 * Ajoute les espaces qui séparent proprement la citation du texte voisin,
 * sans doubler ceux déjà présents (même règle qu'OpenChamber).
 */
export function withInlineInsertionBoundaries(content: string, before: string, after: string): string {
  if (!content) return content;
  const needsLeadingSpace = before.length > 0
    && !/\s$/.test(before)
    && !/^\s/.test(content)
    && !/[([{]$/.test(before);
  const needsTrailingSpace = after.length > 0
    && !/\s$/.test(content)
    && !/^\s/.test(after)
    && !/^[\])}.,;:!?]/.test(after);
  return `${needsLeadingSpace ? ' ' : ''}${content}${needsTrailingSpace ? ' ' : ''}`;
}

/** Texte collé + citation : la citation suit le texte, séparée par une espace. */
export function buildImagePasteInsertion(pastedText: string, citationText: string): string {
  if (!pastedText) return citationText;
  return `${pastedText}${/\s$/.test(pastedText) ? '' : ' '}${citationText}`;
}

/**
 * Insère les citations dans le brouillon à la position `[start, end)` et rend
 * le texte suivant avec la position du curseur après l'insertion. Pur, donc
 * testable pour un champ vide, un curseur en fin, au milieu, ou une sélection.
 */
export function insertAttachmentCitations(
  current: string,
  start: number,
  end: number,
  filenames: string[],
  leadingText = '',
): { next: string; caret: number } | null {
  const clean = filenames.filter(Boolean);
  if (!clean.length && !leadingText) return null;
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const insertion = withInlineInsertionBoundaries(
    buildImagePasteInsertion(leadingText, buildAttachmentCitationText(clean)),
    current.slice(0, from),
    current.slice(to),
  );
  if (!insertion) return null;
  return {
    next: `${current.slice(0, from)}${insertion}${current.slice(to)}`,
    caret: from + insertion.length,
  };
}
