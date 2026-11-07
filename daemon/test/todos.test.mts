import { describe, expect, test } from 'bun:test';
import { extractTodos, normalizeTodos, snapshotOf, todoPlan } from '../src/todos.mts';

describe('todos', () => {
  test('normalise une liste du plugin', () => {
    const items = normalizeTodos([
      { content: 'Lire', status: 'completed', priority: 'high' },
      { content: 'Écrire', status: 'in_progress', priority: 'low' },
      { content: 'Vérifier' },
      { content: '  ' },
    ]);
    expect(items).toEqual([
      { content: 'Lire', status: 'completed', priority: 'high' },
      { content: 'Écrire', status: 'in_progress', priority: 'low' },
      { content: 'Vérifier', status: 'pending', priority: 'medium' },
    ]);
  });

  test('extrait le dernier todowrite par metadata, même après un autre outil', () => {
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'todowrite', state: { status: 'completed', metadata: { todos: [{ content: 'A', status: 'completed', priority: 'high' }] } } },
        ],
      },
      {
        content: [
          { type: 'tool', tool: 'shell', state: { status: 'completed', input: { command: 'pwd' } } },
          { type: 'tool', name: 'todowrite', state: { status: 'completed', metadata: { todos: [
            { content: 'A', status: 'completed', priority: 'high' },
            { content: 'B', status: 'in_progress', priority: 'medium' },
          ] } } },
        ],
      },
    ];
    expect(extractTodos(messages).map(t => t.content)).toEqual(['A', 'B']);
  });

  test('accepte input.todos quand metadata manque', () => {
    const messages = [{ content: [{ type: 'tool', tool: 'todowrite:0', state: { input: { todos: [{ content: 'X', status: 'pending', priority: 'low' }] } } }] }];
    expect(extractTodos(messages)[0]?.content).toBe('X');
  });

  test('todoupdate est aussi une source : le dernier part gagne', () => {
    const todos = [
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'in_progress', priority: 'medium' },
      { content: 'C', status: 'pending', priority: 'low' },
    ];
    const messages = [
      {
        content: [
          { type: 'tool', tool: 'todowrite', state: { status: 'completed', metadata: { todos: todos.slice(0, 2) } } },
        ],
      },
      {
        content: [
          // mise à jour unitaire par numéro : le part porte la liste complète
          { type: 'tool', tool: 'todoupdate', state: { status: 'completed', metadata: { todos } } },
        ],
      },
    ];
    expect(extractTodos(messages)).toEqual(todos);
  });

  test('progression : 50 %, 99 % quand tout est fait, null sans plan', () => {
    const half = snapshotOf([
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'pending', priority: 'low' },
    ]);
    expect(half.done).toBe(1);
    expect(half.total).toBe(2);
    expect(half.progress).toBe(50);
    const all = snapshotOf([{ content: 'A', status: 'completed', priority: 'high' }]);
    expect(all.progress).toBe(99);
    expect(snapshotOf([]).progress).toBeNull();
  });

  test('convertit en plan compatible avec le verdict', () => {
    const snap = snapshotOf([
      { content: 'A', status: 'completed', priority: 'high' },
      { content: 'B', status: 'in_progress', priority: 'low' },
    ]);
    expect(todoPlan(snap)).toEqual([{ step: 'A', done: true }, { step: 'B', done: false }]);
  });
});
