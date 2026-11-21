import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { shredStep } from '@keelwerk/core';
import { startPostgres } from '@keelwerk/testing/postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seed } from './support/erasure-helpers.ts';
import { bootProbe, type Probe } from './support/erasure-kit.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the shred step on PostgreSQL', () => {
  let postgres: Awaited<ReturnType<typeof startPostgres>>;
  let probe: Probe;

  beforeAll(async () => {
    postgres = await startPostgres({ checkDeadlocks: true });
    probe = await bootProbe('memory', {
      external: {
        factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
        url: postgres.appUrl,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await probe?.runtime.stop();
    await postgres?.stop();
  });

  test('two units on one subject that has a key both end: no deadlock, and both answer the one tombstone', async () => {
    const ids = await seed(probe);
    // Ada has a data key: her values were sealed under it.
    const live = await probe.inTenant((unit) => unit.keys.dataKey(ids.adaId, { create: false }));
    expect(live).toBeDefined();
    let arrived = 0;
    const both = Promise.withResolvers<void>();
    // Holds each unit after its first statement until both have taken it, or for a moment when the
    // other unit is queued behind it (the lock order that never deadlocks): the old order, which
    // took a share lock on the key row first, has both units here and ends in a deadlock.
    const afterFirstShred = async (): Promise<void> => {
      arrived += 1;
      if (arrived === 2) both.resolve();
      await Promise.race([both.promise, pause(500)]);
    };
    const run = () =>
      probe.inTenant((unit) =>
        shredStep(unit, {
          keys: probe.runtime.keys,
          subjectId: ids.adaId,
          at: Temporal.Now.instant(),
          afterFirstShred,
        }),
      );
    const answers = await Promise.all([run(), run()]);
    const keyIds = answers.map((tombstones) => tombstones.map((tombstone) => tombstone.keyId));
    expect(keyIds[0]).toHaveLength(1);
    expect(keyIds[1]).toEqual(keyIds[0]);
    const shredded = await probe.inTenant((unit) => unit.keys.shreddedKeys(ids.adaId));
    expect(shredded.map((shreddedKey) => shreddedKey.keyId)).toEqual(keyIds[0]);
  });
});
