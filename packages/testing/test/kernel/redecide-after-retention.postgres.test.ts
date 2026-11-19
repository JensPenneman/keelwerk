import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { retention } from '@keelwerk/events';
import { afterAll, expect, test } from 'vitest';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { createTestDatabase } from '../support/create-test-database.ts';
import { type BootedKeep, bootKeep, reissueAcrossRetention } from './support/replay-kit.ts';

let keep: BootedKeep | undefined;

afterAll(async () => {
  await keep?.runtime.stop();
});

test('a decision inside the window re-decides on PostgreSQL after retention ran over the row it read', {
  timeout: 180_000,
}, async () => {
  const database = await createTestDatabase('redecide_after_retention');
  const worker = retention();
  keep = await bootKeep('memory', {
    eventWorkers: [worker],
    external: { factory: postgresAdapter({ ownerUrl: database.adminUrl }), url: database.appUrl },
  });
  const { commandId, input } = await reissueAcrossRetention(keep, worker);
  const result = await expectReproduces(keep.runtime, { commandId, input });
  expect(result.refused).toBeUndefined();
  expect(result.reproduced).toBe(true);
});
