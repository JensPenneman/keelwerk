import type { ConsumerSpec, Scope } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { observer } from './support/observer-module.ts';
import type { ReactionsKit } from './support/reactions-kit.ts';
import { bootReactions } from './support/reactions-kit.ts';
import type { RelayApp } from './support/relay-app.ts';
import { relay } from './support/relay-module.ts';
import { watch } from './support/watch-module.ts';

// The relay app plus an on-all observer: the runtime writes events of the deployment too, and a
// job for one of them could never be decided (a deployment-scope action is for operators only).
const app = defineApp({
  id: 'relayapp',
  modules: [relay, watch, observer] as never,
}) as unknown as RelayApp;

describe.each(['memory', 'pglite'] as const)('the scope of a reaction job on %s', (adapter) => {
  const levels: Scope['level'][] = [];
  let kit: ReactionsKit;

  beforeAll(async () => {
    kit = await bootReactions({
      adapter,
      app,
      watched: true,
      wrap: (spec: ConsumerSpec): ConsumerSpec => ({
        ...spec,
        consume: (events, unit) => {
          levels.push(...events.map((event) => event.scope.level));
          return spec.consume(events, unit);
        },
      }),
    });
  }, 120_000);
  afterAll(() => kit.stop());

  test('an on-all reaction gets no job for an event of the deployment, nothing is dead, and the dispatcher reads on', async () => {
    await kit.settle();
    expect(levels).toContain('deployment');
    const jobs = (kit.spy?.enqueued ?? []).map((one) => one.job);
    expect(
      jobs.filter((job) => job.queue === 'reactions' && job.scope.level === 'deployment'),
    ).toEqual([]);
    expect((kit.spy?.completions ?? []).filter((one) => one.outcome.kind === 'dead')).toEqual([]);
    expect(await kit.dispatcher.settled()).toBe(0);
  });

  test("the same reaction still gets a job for an event in the tenant, and for an event of another tenant in that tenant's own unit", async () => {
    expect((await kit.send('acme', { channel: 'a' })).ok).toBe(true);
    expect((await kit.send('globex', { channel: 'g' })).ok).toBe(true);
    await kit.settle();
    for (const tenant of ['acme', 'globex'] as const) {
      const seen = await kit.rows(tenant, 'observer.seenEvent');
      expect(seen.map((row) => String(row.type))).toContain('relay.signal.created');
    }
    const observed = (kit.spy?.enqueued ?? [])
      .map((one) => one.job)
      .filter(
        (job) =>
          job.queue === 'reactions' &&
          'action' in job.run &&
          job.run.action === 'observer.observeAll',
      );
    for (const tenant of ['acme', 'globex'] as const) {
      expect(observed.map((job) => job.scope)).toContainEqual(kit.scopeOf(tenant));
    }
    expect(observed.filter((job) => job.scope.level === 'deployment')).toEqual([]);
    expect((kit.spy?.completions ?? []).filter((one) => one.outcome.kind === 'dead')).toEqual([]);
  });
});
