import { describe, expect, test } from 'vitest';
import { assertDeadlocksKept } from '../src/postgres/assert-deadlocks-kept.ts';

describe('assertDeadlocksKept', () => {
  test('rejects a counter that fell across the restart, naming both readings', () => {
    expect(() => assertDeadlocksKept(1, 0)).toThrow(/fell from 1 to 0/);
  });

  test('passes a counter that stayed or grew', () => {
    expect(() => assertDeadlocksKept(1, 1)).not.toThrow();
    expect(() => assertDeadlocksKept(0, 2)).not.toThrow();
  });
});
