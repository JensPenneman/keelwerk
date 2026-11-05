import { describe, expect, test } from 'vitest';
import { cacheDrops } from './cache-drops.ts';

describe('cacheDrops', () => {
  test('a single row names itself', () => {
    expect(cacheDrops({ key: 'k', entity: 'auth.session', id: 's1' })).toEqual([
      { entity: 'auth.session', id: 's1' },
    ]);
  });

  test('a list names the session and its credential', () => {
    const drops = [
      { entity: 'auth.session', id: 's1' },
      { entity: 'auth.credential', id: 'c1' },
    ];
    expect(cacheDrops({ key: 'k', drops })).toEqual(drops);
  });
});
