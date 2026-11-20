import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loopApp } from './support/loop-module.ts';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions, tenantEventsOf } from './support/reactions-kit.ts';

describe.each(['memory', 'pglite'] as const)('a drain of the workers on %s', (adapter) => {
  let kit: ReactionsKit;
  beforeAll(async () => {
    kit = await bootReactions({ adapter, app: loopApp });
  }, 120_000);
  afterAll(async () => {
    await kit.stop();
  });

  const beats = async () =>
    (await tenantEventsOf(kit, 'acme')).filter((event) => event.type === 'loop.beat.created');

  test('takes the job that a promotion makes due in the drain that promotes it', async () => {
    const started = await kit.call('acme', 'loop.start', { via: 'deadline' });
    expect(started.ok).toBe(true);
    await kit.settle();
    const before = (await beats()).length;
    // The effect's deadline job is `scheduled` until the clock passes it and no tick of the wall clock
    // sweeps before the drain, so the one drain runs it (its answer); the continuation it enqueues is
    // asserted only after a settle that follows, since no drain guarantees it ran in the same one.
    kit.pin(kit.now().add({ seconds: 2 }));
    expect(await kit.runtime.drainJobs()).toBeGreaterThanOrEqual(1);
    await kit.settle();
    expect(await beats()).toHaveLength(before + 1);
  });
});
