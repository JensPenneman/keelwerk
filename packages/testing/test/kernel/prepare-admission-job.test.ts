import type { SubjectId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { drainHooks } from './support/hooks-reads.ts';
import { putOverTheLimits, readStore, watchQuotaLoads } from './support/over-the-limit.ts';
import { pingRuns } from './support/probes-module.ts';
import { watchedHooks } from './support/watched-hooks.ts';

// The admission of a command with `prepare` on the job path: the runtime's worker takes a command
// job of a tenant over its storage limits and runs `probes.look`, a command with `prepare`. What
// decides the case: the refused takes (no worker moves anything before the test lets one), the
// awaited drains, the completions of the job store, the executor's count, the rows and the counters.

const start = Temporal.Instant.from('2026-03-01T00:00:00Z');

describe('admission of a command job', () => {
  test("a command job that runs a command with prepare for an over-limit tenant is refused before prepare by the runtime's worker", async () => {
    const cleanup: (() => Promise<void>)[] = [];
    const loads = watchQuotaLoads();
    const booted = await watchedHooks(start, cleanup, undefined, {
      operators: true,
      logger: loads.logger,
    });
    try {
      // No worker takes anything until the test lets the command job go: the store it starts from
      // is read first, and nothing in the background moves a counter before it.
      booted.spy.refuseTake = () => true;
      const owner = crypto.randomUUID() as SubjectId;
      const asked = await booted.client.attempt('probes.lookLater', { owner });
      expect(asked.ok).toBe(true);
      const over = {
        runtime: booted.runtime,
        scope: booted.scope,
        loads,
        grow: () => booted.client.attempt('hooks.notify', { payload: 'grow' }),
      };
      // `putOverTheLimits` sends a second command, so that both counters stand above 1.
      expect((await over.grow()).ok).toBe(true);
      await putOverTheLimits(over);
      const holdings = async () => {
        const read = await readStore(over);
        return {
          counted: read.counted,
          rows: read.rows,
          effectEvents: read.events.filter((event) => event.stream.type === 'core.effect').length,
          attempts: (read.streams.get('core.effectAttempt') ?? []).length,
        };
      };
      const stood = await holdings();
      expect(stood.counted).toBeGreaterThan(1n);
      const ran = pingRuns.count;
      const taken = booted.spy.completions.length;
      // Only the queue of the command job is let go: the effect job of `grow` stays untaken.
      booted.spy.refuseTake = (queue) => queue !== 'commands';
      await drainHooks(booted);
      const ended = booted.spy.completions.slice(taken);
      expect(ended).toHaveLength(1);
      expect(ended[0]?.outcome).toMatchObject({
        kind: 'failed',
        error: { code: 'core.quota_exceeded' },
      });
      expect(pingRuns.count).toBe(ran);
      expect(await holdings()).toEqual(stood);
    } finally {
      await Promise.allSettled(cleanup.map((close) => close()));
    }
  });
});
