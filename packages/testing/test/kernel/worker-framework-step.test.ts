import type { AppliedMigration, NamespaceRef } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { askCloseAll, lendBook, lines, startWatched, statsOf } from './support/worker-kit.ts';

const at = Temporal.Instant.from('2026-01-01T00:00:00Z');
const applied = (id: string): AppliedMigration => ({
  track: 'keelwerk.framework',
  id,
  checksum: 'x',
  appliedAt: at,
  stepsApplied: 1,
});

describe('a namespace whose framework track misses step 0002 gives no jobs to a worker (D8)', () => {
  test('the job waits and one warning is logged; step 0002 releases it at the next wake', async () => {
    const log = lines();
    const history = [applied('0001')];
    const { runtime } = await startWatched({
      workers: true,
      logger: log.logger,
      configure: (spy) => {
        spy.capabilities = { sql: { dialect: 'postgres' } };
        spy.history = (namespace: NamespaceRef) =>
          namespace.id === 'ns-control' ? undefined : history;
      },
    });
    await lendBook(runtime, 'Dune');
    await askCloseAll(runtime, 'f-1');
    expect(await runtime.drainJobs()).toBe(0);
    expect(await runtime.drainJobs()).toBe(0);
    expect((await statsOf(runtime, 'commands'))?.due).toBe(1);
    expect(log.warnings.filter((line) => line.includes('framework step 0002'))).toHaveLength(1);
    history.push(applied('0002'));
    expect(await runtime.drainJobs()).toBe(1);
    expect((await statsOf(runtime, 'commands'))?.due).toBe(0);
    await runtime.stop();
  });
});
