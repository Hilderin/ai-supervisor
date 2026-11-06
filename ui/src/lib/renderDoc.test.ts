import { describe, expect, test } from 'bun:test';
import { RENDER_MAX_HEIGHT, RENDER_MIN_HEIGHT, buildRenderDocument } from './renderDoc';

describe('buildRenderDocument', () => {
  test('injecte la CSP et le rapport de hauteur dans un document complet', () => {
    const doc = buildRenderDocument('<html><head><title>x</title></head><body><h1>Hi</h1></body></html>');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("form-action 'none'");
    expect(doc).toContain('superviseur:render-height');
    expect(doc).toContain('<h1>Hi</h1>');
  });

  test('ajoute un head quand il manque, sans perdre le corps', () => {
    const doc = buildRenderDocument('<p>extrait</p>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<head>');
    expect(doc).toContain('<body><p>extrait</p></body>');
  });

  test('insère dans <html> quand <head> est absent', () => {
    const doc = buildRenderDocument('<html><body><p>ok</p></body></html>');
    expect(doc).toContain('<head>');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'));
  });

  test('bornes de hauteur cohérentes', () => {
    expect(RENDER_MIN_HEIGHT).toBeLessThan(RENDER_MAX_HEIGHT);
    expect(RENDER_MAX_HEIGHT).toBeGreaterThan(0);
  });
});
