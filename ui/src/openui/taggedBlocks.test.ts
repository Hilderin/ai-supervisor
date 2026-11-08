import { describe, expect, test } from 'bun:test';
import { fenceUiBlocks } from './taggedBlocks';

/**
 * La tolérance d'écriture est celle du chat OpenChamber : un agent peut
 * produire un fence ```openui-lang, ```openui, ou envelopper le programme
 * dans `<openui-lang>`. Le reste du markdown ne doit pas bouger.
 */
describe('fenceUiBlocks', () => {
  test('une balise sur ses propres lignes devient un fence', () => {
    expect(fenceUiBlocks('Picks:\n<openui-lang>\nroot = Stack([a])\na = Text("x")\n</openui-lang>\nMore.'))
      .toBe('Picks:\n```openui-lang\nroot = Stack([a])\na = Text("x")\n```\nMore.');
  });

  test('une balise partagée avec le programme garde chaque ligne', () => {
    expect(fenceUiBlocks('<openui-lang> root = Stack([a])\na = Text("x") </openui-lang> After'))
      .toBe('```openui-lang\n root = Stack([a])\na = Text("x") \n```\nAfter');
  });

  test('une balise non fermée pendant le streaming devient un fence ouvert', () => {
    expect(fenceUiBlocks('<openui-lang>\nroot = Stack([')).toBe('```openui-lang\nroot = Stack([');
  });

  test('une balise dans du code ou en milieu de phrase reste du texte', () => {
    const text = 'Write `<openui-lang>` like this:\n```md\n<openui-lang>\nroot = Stack([])\n</openui-lang>\n```\nSee <openui-lang> above.';
    expect(fenceUiBlocks(text)).toBe(text);
  });

  test('un fence nommé openui devient openui-lang', () => {
    expect(fenceUiBlocks('Path:\n```openui\nroot = Stack([a])\na = Text("x")\n```'))
      .toBe('Path:\n```openui-lang\nroot = Stack([a])\na = Text("x")\n```');
    expect(fenceUiBlocks('```openui\r\nroot = Stack([])\r\n```')).toBe('```openui-lang\nroot = Stack([])\r\n```');
    expect(fenceUiBlocks('~~~~ openui \nroot = Stack([')).toBe('~~~~openui-lang\nroot = Stack([');
  });

  test('un fence openui dans un autre fence reste tel quel', () => {
    const text = '````md\n```openui\nroot = Stack([])\n```\n````';
    expect(fenceUiBlocks(text)).toBe(text);
  });
});
