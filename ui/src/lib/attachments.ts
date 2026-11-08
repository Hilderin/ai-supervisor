/**
 * Pièces jointes du composer : mêmes règles qu'OpenChamber (images et
 * fichiers texte utiles à l'agent), lues en data URL pour que le daemon les
 * transmette telles quelles à OpenCode.
 *
 * Un fichier trop lourd ou d'un type non supporté est refusé AVANT lecture :
 * la saisie reste intacte et l'utilisateur reçoit un message clair.
 */

export interface ComposerAttachment {
  id: string;
  name: string;
  /** type normalisé : images telles quelles, texte en `text/plain`, PDF tel quel */
  mimeType: string;
  size: number;
  dataUrl: string;
}

/** OpenChamber n'inline pas au-delà de 10 Mo : base64 ajoute un tiers. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'jsonl',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'xml',
  'html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'php',
  'sh', 'bash', 'zsh', 'sql', 'diff', 'patch', 'svg', 'ipynb',
]);

const TEXT_MIMES = new Set([
  'application/json', 'application/ld+json', 'application/toml',
  'application/x-toml', 'application/x-yaml', 'application/yaml',
  'application/xml', 'text/xml', 'text/csv', 'text/tab-separated-values',
  'image/svg+xml',
]);

/** Extension en minuscules, sans le point (chaîne vide s'il n'y en a pas). */
export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

/** Taille lisible, comme OpenChamber (octets, Ko, Mo). */
export function formatFileSize(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export type AttachmentVerdict =
  | { ok: true; mimeType: string }
  | { ok: false; error: string };

const UNSUPPORTED_HINT = 'images PNG, JPEG, GIF, WebP, PDF et fichiers texte';

/**
 * Décide du sort d'un fichier sans le lire : type accepté, taille et type
 * MIME normalisé. Pur, donc testable sans navigateur.
 */
export function classifyAttachment(file: { name: string; type?: string; size: number }): AttachmentVerdict {
  const name = file.name || 'fichier';
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `${name} dépasse la limite de ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`,
    };
  }

  const declared = (file.type ?? '').split(';')[0].trim().toLowerCase();
  const extension = extensionOf(name);
  const imageMime = IMAGE_EXTENSIONS[extension];

  // Le SVG est un texte pour OpenCode, pas une image à transmettre au modèle.
  if (declared === 'image/svg+xml' || extension === 'svg') {
    return { ok: true, mimeType: 'text/plain' };
  }
  if (imageMime && (!declared || declared.startsWith('image/'))) {
    return { ok: true, mimeType: imageMime };
  }
  if (declared === 'image/png' || declared === 'image/jpeg' || declared === 'image/gif' || declared === 'image/webp') {
    return { ok: true, mimeType: declared };
  }
  if (declared === 'application/pdf' || extension === 'pdf') {
    return { ok: true, mimeType: 'application/pdf' };
  }
  if (declared.startsWith('text/') || TEXT_MIMES.has(declared) || TEXT_EXTENSIONS.has(extension)) {
    return { ok: true, mimeType: 'text/plain' };
  }
  return {
    ok: false,
    error: `${name} : type de fichier non supporté (${UNSUPPORTED_HINT}).`,
  };
}

async function readWithoutFileReader(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function readAsDataUrl(file: Blob): Promise<string> {
  // FileReader est le chemin navigateur ; le repli sert aux tests (Bun).
  if (typeof FileReader === 'undefined') return readWithoutFileReader(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('lecture impossible'));
    reader.readAsDataURL(file);
  });
}

/** Remplace le type MIME d'une data URL sans toucher aux octets. */
export function withMimeType(dataUrl: string, mimeType: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl;
  const base64 = /;base64$/i.test(dataUrl.slice(0, comma)) ? ';base64' : '';
  return `data:${mimeType}${base64}${dataUrl.slice(comma)}`;
}

function attachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type PrepareResult =
  | { ok: true; attachment: ComposerAttachment }
  | { ok: false; error: string };

/** Valide puis lit UN fichier. Ne lève jamais : l'erreur est une valeur. */
export async function prepareAttachment(file: File): Promise<PrepareResult> {
  const verdict = classifyAttachment(file);
  if (!verdict.ok) return verdict;
  const name = file.name || 'fichier';
  try {
    const raw = await readAsDataUrl(file);
    if (!raw) return { ok: false, error: `${name} : lecture impossible.` };
    return {
      ok: true,
      attachment: {
        id: attachmentId(),
        name,
        mimeType: verdict.mimeType,
        size: file.size,
        dataUrl: withMimeType(raw, verdict.mimeType),
      },
    };
  } catch {
    return { ok: false, error: `${name} : lecture impossible.` };
  }
}

/** Valide et lit plusieurs fichiers ; les refus n'empêchent pas les autres. */
export async function prepareAttachments(files: Iterable<File>): Promise<{
  attachments: ComposerAttachment[];
  errors: string[];
}> {
  const attachments: ComposerAttachment[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = await prepareAttachment(file);
    if (result.ok) attachments.push(result.attachment);
    else errors.push(result.error);
  }
  return { attachments, errors };
}
