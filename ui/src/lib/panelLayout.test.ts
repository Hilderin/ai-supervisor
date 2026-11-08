import { describe, expect, test } from 'bun:test';
import {
  MIN_INSPECTOR_WIDTH,
  clampInspectorWidth,
  inspectorMaxWidth,
  panelWidths,
} from './panelLayout';

describe('inspectorMaxWidth', () => {
  test('70 % de la fenêtre', () => {
    expect(inspectorMaxWidth(1920, 1510)).toBe(1344);
    expect(inspectorMaxWidth(1600, 1190)).toBe(1120);
  });

  test('jamais plus que la place disponible', () => {
    expect(inspectorMaxWidth(1920, 900)).toBe(900);
    expect(inspectorMaxWidth(1200, 810)).toBe(810);
  });

  test('le plafond arrondit vers le bas (ne dépasse jamais 70 %)', () => {
    expect(inspectorMaxWidth(1371, 961)).toBe(959);
  });
});

describe('clampInspectorWidth', () => {
  test('plafonne à 70 % de la fenêtre', () => {
    expect(clampInspectorWidth(2000, 1920, 1510)).toBe(1344);
  });

  test('plancher à la largeur minimale utilisable', () => {
    expect(clampInspectorWidth(10, 1920, 1510)).toBe(MIN_INSPECTOR_WIDTH);
  });

  test('la place disponible prime sur le ratio', () => {
    expect(clampInspectorWidth(2000, 1101, 691)).toBe(691);
  });
});

describe('panelWidths', () => {
  test('fenêtre large : le détail prend sa largeur voulue, le central le reste', () => {
    expect(
      panelWidths({ windowWidth: 1920, availableWidth: 1510, inspectorWanted: 460, centerWanted: 1050 }),
    ).toEqual({ inspector: 460, center: 1050 });
  });

  test('au rétrécissement, le central garde sa largeur et le détail absorbe', () => {
    const before = panelWidths({
      windowWidth: 1920,
      availableWidth: 1510,
      inspectorWanted: 460,
      centerWanted: 1050,
    });
    const after = panelWidths({
      windowWidth: 1800,
      availableWidth: 1390,
      inspectorWanted: 460,
      centerWanted: 1050,
    });
    expect(after.center).toBe(before.center);
    expect(after.inspector).toBe(before.inspector - 120);
  });

  test('sous le minimum du détail, seul le central se réduit', () => {
    const after = panelWidths({
      windowWidth: 1400,
      availableWidth: 990,
      inspectorWanted: 460,
      centerWanted: 1050,
    });
    expect(after.inspector).toBe(MIN_INSPECTOR_WIDTH);
    expect(after.center).toBe(710);
  });

  test('le plafond de 70 % borne le détail même si le central est prêt à céder', () => {
    const after = panelWidths({
      windowWidth: 1920,
      availableWidth: 1510,
      inspectorWanted: 2000,
      centerWanted: 80,
    });
    expect(after.inspector).toBe(1344);
    expect(after.center).toBe(166);
  });

  test('aucun débordement : les deux largeurs remplissent exactement la place', () => {
    for (const availableWidth of [1510, 1390, 990, 691, 400]) {
      const { inspector, center } = panelWidths({
        windowWidth: 1920,
        availableWidth,
        inspectorWanted: 460,
        centerWanted: 1050,
      });
      expect(inspector + center).toBe(Math.floor(availableWidth));
      expect(inspector).toBeLessThanOrEqual(availableWidth);
      expect(center).toBeGreaterThanOrEqual(0);
    }
  });

  test('sans préférence de centre, le détail prend sa largeur et le centre suit', () => {
    expect(
      panelWidths({ windowWidth: 1920, availableWidth: 1510, inspectorWanted: 1344, centerWanted: 0 }),
    ).toEqual({ inspector: 1344, center: 166 });
  });
});
