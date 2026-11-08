import { describe, expect, test } from 'bun:test';
import {
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  extensionOf,
  formatFileSize,
  prepareAttachment,
  withMimeType,
} from './attachments';

const file = (name: string, type: string, size = 10): { name: string; type: string; size: number } => ({ name, type, size });

describe('classifyAttachment', () => {
  test('accepte les images courantes et normalise le type', () => {
    expect(classifyAttachment(file('capture.png', 'image/png'))).toEqual({ ok: true, mimeType: 'image/png' });
    expect(classifyAttachment(file('photo.JPG', ''))).toEqual({ ok: true, mimeType: 'image/jpeg' });
    expect(classifyAttachment(file('anim.webp', 'image/webp'))).toEqual({ ok: true, mimeType: 'image/webp' });
  });

  test('transmet le SVG comme du texte, pas comme une image', () => {
    expect(classifyAttachment(file('icone.svg', 'image/svg+xml'))).toEqual({ ok: true, mimeType: 'text/plain' });
  });

  test('accepte les fichiers texte, même sans type déclaré', () => {
    expect(classifyAttachment(file('notes.md', ''))).toEqual({ ok: true, mimeType: 'text/plain' });
    expect(classifyAttachment(file('data.json', 'application/json'))).toEqual({ ok: true, mimeType: 'text/plain' });
    expect(classifyAttachment(file('journal.log', 'text/plain'))).toEqual({ ok: true, mimeType: 'text/plain' });
  });

  test('accepte le PDF tel quel', () => {
    expect(classifyAttachment(file('doc.pdf', 'application/pdf'))).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  test('refuse un binaire non supporté avec un message clair', () => {
    const verdict = classifyAttachment(file('archive.zip', 'application/zip'));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('archive.zip');
    expect(verdict.error).toContain('non supporté');
  });

  test('refuse un fichier trop lourd sans le lire', () => {
    const verdict = classifyAttachment(file('gros.bin', 'application/zip', MAX_ATTACHMENT_BYTES + 1));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error).toContain('limite');
  });

  test('accepte un fichier juste à la limite', () => {
    expect(classifyAttachment(file('limite.png', 'image/png', MAX_ATTACHMENT_BYTES)).ok).toBe(true);
  });
});

describe('prepareAttachment', () => {
  test('rend une data URL avec le type normalisé', async () => {
    const result = await prepareAttachment(new File(['bonjour'], 'note.txt', { type: 'text/plain' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.name).toBe('note.txt');
    expect(result.attachment.mimeType).toBe('text/plain');
    expect(result.attachment.dataUrl.startsWith('data:text/plain;base64,')).toBe(true);
    expect(result.attachment.size).toBe(7);
  });

  test('ne lève pas sur un refus : le fichier voisin reste possible', async () => {
    const result = await prepareAttachment(new File(['x'], 'archive.zip', { type: 'application/zip' }));
    expect(result.ok).toBe(false);
  });
});

describe('withMimeType', () => {
  test('remplace le type sans toucher aux octets', () => {
    expect(withMimeType('data:application/octet-stream;base64,AAAA', 'text/plain'))
      .toBe('data:text/plain;base64,AAAA');
  });
});

describe('formatFileSize', () => {
  test('affiche des tailles lisibles', () => {
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(512)).toBe('512 o');
    expect(formatFileSize(2048)).toBe('2,0 Ko');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2,0 Mo');
  });
});

describe('extensionOf', () => {
  test('lit la dernière extension en minuscules', () => {
    expect(extensionOf('Rapport.PDF')).toBe('pdf');
    expect(extensionOf('sans-extension')).toBe('');
    expect(extensionOf('.env')).toBe('env');
  });
});
