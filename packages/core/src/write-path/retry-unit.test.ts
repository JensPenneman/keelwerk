import { describe, expect, test } from 'vitest';
import { uniqueConflict } from '../errors/unique-conflict.ts';
import { retryUnit } from './retry-unit.ts';

const options = { sleep: async () => undefined };

describe('retryUnit and a unique violation', () => {
  test('is not repeated unless the unit is a command unit', async () => {
    let runs = 0;
    const failure = uniqueConflict('c', undefined);
    await expect(
      retryUnit(async () => {
        runs += 1;
        throw failure;
      }, options),
    ).rejects.toBe(failure);
    expect(runs).toBe(1);
  });

  test('is repeated once for a command unit', async () => {
    let runs = 0;
    const result = await retryUnit(
      async () => {
        runs += 1;
        if (runs === 1) throw uniqueConflict('c', undefined);
        return 'done';
      },
      { ...options, retryUnique: true },
    );
    expect(result).toBe('done');
    expect(runs).toBe(2);
  });

  test('is a conflict again when the repeat violates too', async () => {
    let runs = 0;
    await expect(
      retryUnit(
        async () => {
          runs += 1;
          throw uniqueConflict('c', undefined);
        },
        { ...options, retryUnique: true },
      ),
    ).rejects.toMatchObject({ kind: 'conflict', details: { unique: true, constraint: 'c' } });
    expect(runs).toBe(2);
  });
});
