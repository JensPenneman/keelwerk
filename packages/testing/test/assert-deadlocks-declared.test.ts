import { afterEach, describe, expect, test } from 'vitest';
import { assertDeadlocksDeclared } from '../src/postgres/assert-deadlocks-declared.ts';
import { declareDeadlocks } from '../src/postgres/declare-deadlocks.ts';
import { declaredDeadlocks } from '../src/postgres/declared-deadlocks.ts';

afterEach(() => {
  declaredDeadlocks.count = 0;
});

describe('assertDeadlocksDeclared', () => {
  test('rejects a deadlock that no case declared, naming both numbers', () => {
    expect(() => assertDeadlocksDeclared(1, 0)).toThrow(/by 1 and declared 0/);
  });

  test('rejects a declaration with no deadlock behind it', () => {
    expect(() => assertDeadlocksDeclared(0, 1)).toThrow(/by 0 and declared 1/);
  });

  test('passes when the counter moved by exactly what was declared, none included', () => {
    expect(() => assertDeadlocksDeclared(0, 0)).not.toThrow();
    expect(() => assertDeadlocksDeclared(2, 2)).not.toThrow();
  });
});

describe('declareDeadlocks', () => {
  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as a count',
    (count) => {
      expect(() => declareDeadlocks(count)).toThrow(/whole number of at least 1/);
      expect(declaredDeadlocks.count).toBe(0);
    },
  );

  test('adds the declarations of a file up', () => {
    declareDeadlocks(1);
    declareDeadlocks(2);
    expect(declaredDeadlocks.count).toBe(3);
  });
});
