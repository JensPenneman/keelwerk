import { expect, test } from 'vitest';
import { limitAbove } from './limit-above.ts';

test('a count is above by value; a rate when its capacity or its refill is', () => {
  expect(limitAbove({ kind: 'count', value: 6 }, { kind: 'count', value: 5 })).toBe(true);
  expect(limitAbove({ kind: 'count', value: 5 }, { kind: 'count', value: 5 })).toBe(false);
  expect(limitAbove({ kind: 'bytes', value: 4 }, { kind: 'bytes', value: 5 })).toBe(false);
  const bound = { kind: 'rate', capacity: 10, refillPerSecond: 1 } as const;
  expect(limitAbove({ ...bound }, bound)).toBe(false);
  expect(limitAbove({ ...bound, capacity: 11 }, bound)).toBe(true);
  expect(limitAbove({ ...bound, refillPerSecond: 2 }, bound)).toBe(true);
  expect(limitAbove({ kind: 'rate', capacity: 5, refillPerSecond: 0.5 }, bound)).toBe(false);
});
