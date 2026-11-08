/**
 * Conversion des pièces jointes de l'UI vers les deux formes OpenChamber.
 * Aucune base : helpers purs.
 */
import { describe, expect, test } from 'bun:test';
import { toPromptFiles, toQueueAttachments } from '../src/attachments.mts';

const image = {
  id: 'a1',
  name: 'capture.png',
  mimeType: 'image/png',
  size: 1234,
  dataUrl: 'data:image/png;base64,AAAA',
};

const note = {
  id: 'a2',
  name: 'note.txt',
  mimeType: 'text/plain',
  size: 5,
  dataUrl: 'data:text/plain;base64,aGVsbG8=',
};

describe('toPromptFiles', () => {
  test('rend des URIs pour le prompt v2, nom inclus', () => {
    expect(toPromptFiles([image, note])).toEqual([
      { uri: image.dataUrl, name: 'capture.png' },
      { uri: note.dataUrl, name: 'note.txt' },
    ]);
  });

  test('ignore ce qui n’est pas une data URL', () => {
    expect(toPromptFiles([{ name: 'x', dataUrl: 'file:///etc/passwd' }])).toEqual([]);
    expect(toPromptFiles(undefined)).toEqual([]);
    expect(toPromptFiles('nope')).toEqual([]);
  });
});

describe('toQueueAttachments', () => {
  test('rend un objet AttachedFile de la file OpenChamber', () => {
    expect(toQueueAttachments([image])).toEqual([
      {
        id: 'a1', filename: 'capture.png', mimeType: 'image/png', size: 1234,
        source: 'local', dataUrl: image.dataUrl,
      },
    ]);
  });

  test('complète nom et type manquants sans perdre le fichier', () => {
    const [attachment] = toQueueAttachments([{ dataUrl: 'data:image/jpeg;base64,AAAA' }]);
    expect(attachment.filename).toBe('pièce jointe');
    expect(attachment.mimeType).toBe('image/jpeg');
    expect(attachment.size).toBe(0);
  });

  test('ignore une entrée sans data URL', () => {
    expect(toQueueAttachments([{ name: 'x' }, null, 42])).toEqual([]);
  });
});
