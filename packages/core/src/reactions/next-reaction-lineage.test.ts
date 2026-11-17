import { describe, expect, test } from 'vitest';
import { nextReactionLineage } from './next-reaction-lineage.ts';

const eventId = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02';
const origin = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01';

describe('the lineage of the next reaction job', () => {
  test('an event without lineage starts a chain at depth 1 with itself as origin', () => {
    expect(nextReactionLineage({ eventId })).toEqual({ depth: 1, origin: eventId });
  });

  test('a lineage goes one deeper and keeps its origin', () => {
    expect(nextReactionLineage({ eventId, lineage: { depth: 4, origin } })).toEqual({
      depth: 5,
      origin,
    });
  });

  test('a malformed stored lineage starts a new chain', () => {
    expect(nextReactionLineage({ eventId, lineage: { depth: 0, origin } })).toEqual({
      depth: 1,
      origin: eventId,
    });
    expect(nextReactionLineage({ eventId, lineage: { depth: 'deep', origin } as never })).toEqual({
      depth: 1,
      origin: eventId,
    });
  });
});
