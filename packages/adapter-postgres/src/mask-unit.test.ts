import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { maskUnit } from './mask-unit.ts';

function fake(depth: number): Unit {
  return {
    rows: { lock: () => undefined, find: () => undefined },
    nested: async (fn: (inner: Unit) => Promise<unknown>) => fn(fake(depth + 1)),
  } as unknown as Unit;
}

describe('maskUnit', () => {
  test('without rowLocks masked the unit passes unchanged', () => {
    const unit = fake(0);
    expect(maskUnit(unit, [])).toBe(unit);
  });

  test('with rowLocks masked the row store has no lock, and nested units are masked too', async () => {
    const masked = maskUnit(fake(0), ['rowLocks']);
    expect('lock' in masked.rows).toBe(false);
    expect('find' in masked.rows).toBe(true);
    const seen: boolean[] = [];
    await masked.nested(async (inner) => {
      seen.push('lock' in inner.rows);
      await inner.nested(async (deeper) => {
        seen.push('lock' in deeper.rows);
      });
    });
    expect(seen).toEqual([false, false]);
  });
});
