import { describe, expect, test } from 'vitest';
import { reactionMatches } from './reaction-matches.ts';

describe('reactionMatches', () => {
  test('matches a listed event type', () => {
    expect(reactionMatches({ on: ['a.b.created', 'a.b.changed'] }, 'a.b.changed')).toBe(true);
  });

  test('refuses an unlisted event type', () => {
    expect(reactionMatches({ on: ['a.b.created'] }, 'a.b.changed')).toBe(false);
  });

  test("'all' matches any event type", () => {
    expect(reactionMatches({ on: 'all' }, 'x.y.z')).toBe(true);
  });

  test("'all' excludes the excepted event types", () => {
    const reaction = { on: 'all', except: ['x.y.z'] } as const;
    expect(reactionMatches(reaction, 'x.y.z')).toBe(false);
    expect(reactionMatches(reaction, 'x.y.created')).toBe(true);
  });

  test("'all' never matches by substring", () => {
    expect(reactionMatches({ on: 'all', except: ['x.y.z'] }, 'x.y')).toBe(true);
    expect(reactionMatches({ on: ['a.b.created'] }, 'a.b')).toBe(false);
  });
});
