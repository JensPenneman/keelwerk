import { describe, expect, test } from 'vitest';
import { untilTombstoned } from '../../src/erasure/until-tombstoned.ts';

describe('untilTombstoned', () => {
  test('a unit that met keys without a tombstone rolls back, exactly those are recorded, and the pass runs again', async () => {
    const known = new Set(['kept']);
    const recorded: string[][] = [];
    const record = (keyIds: readonly string[]): Promise<void> => {
      recorded.push([...keyIds]);
      for (const keyId of keyIds) known.add(keyId);
      return Promise.resolve();
    };
    let runs = 0;
    const result = await untilTombstoned(known, record, async (gate) => {
      runs += 1;
      await gate.onValueKeys(['kept', 'new-a', 'new-b']);
      gate.check();
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(runs).toBe(2);
    expect(recorded).toEqual([['new-a', 'new-b']]);
  });

  test('a repeat that records no tombstone ends with an error', async () => {
    let runs = 0;
    await expect(
      untilTombstoned(
        new Set<string>(),
        () => Promise.resolve(),
        async (gate) => {
          runs += 1;
          await gate.onValueKeys(['never-recorded']);
          gate.check();
        },
      ),
    ).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(runs).toBe(1);
  });
});
