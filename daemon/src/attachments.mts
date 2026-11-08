/**
 * Pièces jointes reçues de l'UI (data URL) : conversion vers les deux formes
 * qu'OpenChamber attend. Le prompt v2 prend des URIs (`files`), la file
 * d'attente reprend l'objet `AttachedFile` du composer.
 */

export interface PromptFile {
  uri: string;
  name?: string;
}

export interface QueueAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  source: 'local';
  dataUrl: string;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl);
  return match?.[1]?.trim() || 'application/octet-stream';
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `[{ dataUrl, name }]` → `[{ uri, name }]` pour `POST /api/session/:id/prompt`. */
export function toPromptFiles(value: unknown): PromptFile[] {
  const files: PromptFile[] = [];
  for (const item of asList(value)) {
    if (!item || typeof item !== 'object') continue;
    const attachment = item as Record<string, unknown>;
    const uri = typeof attachment.dataUrl === 'string' ? attachment.dataUrl : '';
    if (!uri.startsWith('data:')) continue;
    const name = cleanName(attachment.name);
    files.push(name ? { uri, name } : { uri });
  }
  return files;
}

/** `[{ dataUrl, name, mimeType, size }]` → objets de la file d'attente OpenChamber. */
export function toQueueAttachments(value: unknown): QueueAttachment[] {
  const attachments: QueueAttachment[] = [];
  for (const item of asList(value)) {
    if (!item || typeof item !== 'object') continue;
    const attachment = item as Record<string, unknown>;
    const dataUrl = typeof attachment.dataUrl === 'string' ? attachment.dataUrl : '';
    if (!dataUrl.startsWith('data:')) continue;
    const name = cleanName(attachment.name) || 'pièce jointe';
    const mimeType = cleanName(attachment.mimeType) || mimeFromDataUrl(dataUrl);
    const size = typeof attachment.size === 'number' && Number.isFinite(attachment.size) ? attachment.size : 0;
    const id = cleanName(attachment.id) || `attachment-${attachments.length + 1}`;
    attachments.push({ id, filename: name, mimeType, size, source: 'local', dataUrl });
  }
  return attachments;
}
