import { describe, expect, test } from 'vitest';
import { nextReactionLineage } from './next-reaction-lineage.ts';
import { reactionLineageOf } from './reaction-lineage-of.ts';

const origin = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';

describe('reading a stored lineage', () => {
  test.each([
    ['absent', undefined],
    ['null', null],
    ['a number', 3],
    ['a text', 'x'],
    ['an array', [1, origin]],
    ['a depth of 0', { depth: 0, origin }],
    ['a depth of -1', { depth: -1, origin }],
    ['a depth of 1.5', { depth: 1.5, origin }],
    ['a depth of 2^31', { depth: 2 ** 31, origin }],
    ['a depth that is text', { depth: '2', origin }],
    ['no depth', { origin }],
    ['no origin', { depth: 2 }],
    ['an origin that is no text', { depth: 2, origin: 7 }],
    ['an empty origin', { depth: 2, origin: '' }],
    ['an origin of 65 characters', { depth: 2, origin: 'a'.repeat(65) }],
  ])('%s reads as depth 0, never a throw', (_name, value) => {
    expect(reactionLineageOf(value)).toBeUndefined();
  });

  test('a valid lineage comes back without its other members', () => {
    const read = reactionLineageOf({ depth: 3, origin, extra: true });
    expect(read).toEqual({ depth: 3, origin });
    expect(Object.keys(read ?? {})).toEqual(['depth', 'origin']);
    expect(reactionLineageOf({ depth: 2_147_483_647, origin: 'a'.repeat(64) })).toEqual({
      depth: 2_147_483_647,
      origin: 'a'.repeat(64),
    });
  });

  test('the dispatcher keeps every depth it writes below the first one that reads as depth 0', () => {
    // maxDepth is at most 2,147,483,646: a job at that depth, and the event it writes, read back as they are.
    const atBound = { depth: 2_147_483_646, origin };
    expect(reactionLineageOf(atBound)).toEqual(atBound);
    expect(nextReactionLineage({ eventId: 'e-1', lineage: atBound })).toEqual({
      depth: 2_147_483_647,
      origin,
    });
    // One job deeper would be written as 2^31 and read as malformed: the chain would start again.
    const past = nextReactionLineage({
      eventId: 'e-1',
      lineage: { depth: 2_147_483_647, origin },
    });
    expect(past.depth).toBe(2 ** 31);
    expect(reactionLineageOf(past)).toBeUndefined();
  });
});
