import { describe, expect, test } from 'vitest';
import { generatedActionsOf } from './generated-actions-of.ts';

const chain = { history: 'chain', generated: {} } as const;

describe('generatedActionsOf (section 6.7)', () => {
  test('a chain or state entity has the reads and every set operation', () => {
    const all = [
      'get',
      'query',
      'changes',
      'queryChanges',
      'create',
      'update',
      'archive',
      'restore',
      'set',
    ];
    expect(generatedActionsOf(chain, [])).toEqual(all);
    expect(generatedActionsOf({ history: 'state', generated: {} }, [])).toEqual(all);
  });

  test('projection entities have no set operations and external ones only get and query', () => {
    expect(generatedActionsOf({ history: 'projection', generated: {} }, ['watch'])).toEqual([
      'get',
      'query',
      'changes',
      'queryChanges',
      'watch',
    ]);
    expect(generatedActionsOf({ history: 'external', generated: {} }, ['watch'])).toEqual([
      'get',
      'query',
    ]);
  });

  test('set: false removes the set operations together and history: true adds history', () => {
    expect(
      generatedActionsOf({ history: 'chain', generated: { set: false, history: true } }, []),
    ).toEqual(['get', 'query', 'changes', 'queryChanges', 'history']);
  });

  test('a generator module adds watch to every entity that is not external', () => {
    expect(generatedActionsOf(chain, ['watch'])).toContain('watch');
    expect(
      generatedActionsOf({ history: 'chain', generated: { watch: false } }, ['watch']),
    ).not.toContain('watch');
  });

  test('a switched-off read is removed', () => {
    expect(
      generatedActionsOf({ history: 'chain', generated: { changes: false } }, []),
    ).not.toContain('changes');
  });
});
