import { describe, expect, test } from 'bun:test';
import {
  assignImageCitationNames,
  buildAttachmentCitationText,
  buildImagePasteInsertion,
  citationNamesInText,
  insertAttachmentCitations,
  isGenericImageFilename,
  renameFileForCitation,
  sanitizeAttachmentFilename,
  withInlineInsertionBoundaries,
} from './attachmentCitations';

const image = (name: string, type = 'image/png') => ({ name, type });

describe('assignImageCitationNames', () => {
  test('numérote les noms génériques de 1 à N', () => {
    expect(assignImageCitationNames([image('image.png'), image('image.png')], []))
      .toEqual(['image-1.png', 'image-2.png']);
    expect(assignImageCitationNames([image('clipboard'), image('blob')], []))
      .toEqual(['image-1.png', 'image-2.png']);
  });

  test('saute les noms déjà pris par une pièce jointe ou une citation', () => {
    expect(assignImageCitationNames([image('image.png')], ['image-1.png']))
      .toEqual(['image-2.png']);
    expect(assignImageCitationNames([image('image.png')], ['image-1.png', 'image-2.png']))
      .toEqual(['image-3.png']);
  });

  test('conserve un nom explicite et ne le suffixe qu’en cas de collision', () => {
    expect(assignImageCitationNames([image('capture-test.png')], []))
      .toEqual(['capture-test.png']);
    expect(assignImageCitationNames([image('capture-test.png')], ['capture-test.png']))
      .toEqual(['capture-test-2.png']);
  });

  test('déduit l’extension du type MIME quand le nom n’en a pas', () => {
    expect(assignImageCitationNames([image('image', 'image/jpeg')], []))
      .toEqual(['image-1.jpg']);
  });

  test('reconnaît les noms de capture avec compteur de copie', () => {
    expect(isGenericImageFilename('Screenshot (1).png')).toBe(true);
    expect(isGenericImageFilename('capture-test.png')).toBe(false);
  });

  test('nettoie les crochets et séparateurs du nom', () => {
    expect(sanitizeAttachmentFilename('/tmp/a[b]/capture [1].png')).toBe('capture -1-.png');
    expect(assignImageCitationNames([image('capture [1].png')], []))
      .toEqual(['capture -1-.png']);
  });
});

describe('buildAttachmentCitationText', () => {
  test('entoure chaque nom de crochets', () => {
    expect(buildAttachmentCitationText(['image-1.png', 'note.txt']))
      .toBe('[image-1.png] [note.txt]');
    expect(buildAttachmentCitationText([])).toBe('');
  });
});

describe('citationNamesInText', () => {
  test('lit les citations et ignore les liens markdown', () => {
    expect(citationNamesInText('Voir [image-1.png] et [notice](doc.md).'))
      .toEqual(['image-1.png']);
    expect(citationNamesInText('rien')).toEqual([]);
  });
});

describe('withInlineInsertionBoundaries', () => {
  test('ajoute les espaces autour de la citation', () => {
    expect(withInlineInsertionBoundaries('[image-1.png]', 'Regarde', '')).toBe(' [image-1.png]');
    expect(withInlineInsertionBoundaries('[image-1.png]', 'Regarde ', '')).toBe('[image-1.png]');
    expect(withInlineInsertionBoundaries('[image-1.png]', '(', '')).toBe('[image-1.png]');
    expect(withInlineInsertionBoundaries('[image-1.png]', 'Regarde', 'ensuite')).toBe(' [image-1.png] ');
    expect(withInlineInsertionBoundaries('[image-1.png]', 'Regarde', ')')).toBe(' [image-1.png]');
  });

  test('un contenu vide reste vide', () => {
    expect(withInlineInsertionBoundaries('', 'a', 'b')).toBe('');
  });
});

describe('buildImagePasteInsertion', () => {
  test('place le texte collé avant la citation', () => {
    expect(buildImagePasteInsertion('', '[image-1.png]')).toBe('[image-1.png]');
    expect(buildImagePasteInsertion('Regarde', '[image-1.png]')).toBe('Regarde [image-1.png]');
    expect(buildImagePasteInsertion('Regarde ', '[image-1.png]')).toBe('Regarde [image-1.png]');
  });
});

describe('renameFileForCitation', () => {
  test('donne à la pièce jointe le nom de sa citation, sans changer son contenu', () => {
    const original = new File(['abc'], 'image.png', { type: 'image/png' });
    const renamed = renameFileForCitation(original, 'image-1.png');
    expect(renamed.name).toBe('image-1.png');
    expect(renamed.type).toBe('image/png');
    expect(renamed.size).toBe(3);
  });

  test('rend le fichier tel quel si le nom est déjà bon', () => {
    const original = new File(['abc'], 'image-1.png', { type: 'image/png' });
    expect(renameFileForCitation(original, 'image-1.png')).toBe(original);
  });
});

describe('insertAttachmentCitations', () => {
  test('champ vide : la citation seule et le curseur après', () => {
    expect(insertAttachmentCitations('', 0, 0, ['image-1.png']))
      .toEqual({ next: '[image-1.png]', caret: 13 });
  });

  test('curseur en fin de texte : une espace avant la citation', () => {
    expect(insertAttachmentCitations('Regarde', 7, 7, ['image-1.png']))
      .toEqual({ next: 'Regarde [image-1.png]', caret: 21 });
  });

  test('curseur au milieu : le texte autour est conservé', () => {
    expect(insertAttachmentCitations('Début fin', 5, 5, ['image-1.png']))
      .toEqual({ next: 'Début [image-1.png] fin', caret: 19 });
  });

  test('une sélection est remplacée', () => {
    expect(insertAttachmentCitations('Début fin', 0, 5, ['image-1.png']))
      .toEqual({ next: '[image-1.png] fin', caret: 13 });
  });

  test('du texte collé avec l’image précède la citation', () => {
    expect(insertAttachmentCitations('Regarde', 7, 7, ['image-1.png'], 'Salut'))
      .toEqual({ next: 'Regarde Salut [image-1.png]', caret: 27 });
  });

  test('plusieurs citations dans un seul collage, séparées par une espace', () => {
    expect(insertAttachmentCitations('', 0, 0, ['image-1.png', 'image-2.png']))
      .toEqual({ next: '[image-1.png] [image-2.png]', caret: 27 });
  });

  test('rien à insérer rend null', () => {
    expect(insertAttachmentCitations('texte', 5, 5, [])).toBeNull();
  });
});
