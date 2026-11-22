import { describe, expect, test } from 'vitest';
import type { StoredJobSpec } from '../storage/stored-job-spec.ts';
import { enqueueTenantHooks } from './enqueue-tenant-hooks.ts';

const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;
const hook = {
  id: 'welcome.onCreated',
  module: 'welcome',
  hook: 'onTenantCreated',
  unit: 'tenant',
};

function setup(quotas: Parameters<typeof enqueueTenantHooks>[0]['quotas']) {
  const enqueued: StoredJobSpec[] = [];
  // The order of the cache's ask and the opening of the unit.
  const events: string[] = [];
  const unit = { jobs: { enqueue: async (job: StoredJobSpec) => void enqueued.push(job) } };
  const input = {
    store: {
      clock: { now: () => Temporal.Instant.from('2026-11-17T08:00:00Z') },
      writer: { build: { id: 'build-1', revision: 1 } },
      log: { error: () => undefined },
    },
    registry: { hooks: new Map([[hook.id, hook]]) },
    target: {
      scope,
      namespace: { id: 'ns' },
      handle: {
        adapter: {
          unit: async (_n: unknown, _s: unknown, fn: (u: unknown) => unknown) => {
            events.push('unit');
            return fn(unit);
          },
        },
      },
    },
    tenant: { id: 't1', name: 'Acme' },
    quotas:
      quotas === undefined
        ? undefined
        : {
            fresh: async () => {
              events.push('ask');
              return quotas.fresh();
            },
          },
  };
  return { input: input as never, enqueued, events };
}

describe('the hooks of a new tenant', () => {
  test('take the lane their queue has for the tenant from the limits asked for before the unit, and carry no queued cap', async () => {
    let loaded = false;
    const { input, enqueued, events } = setup({
      fresh: async () => {
        loaded = true;
        return {
          limitOf: () => ({ kind: 'count', value: 0 }),
          queueOf: (_scope, queue) => ({
            running: loaded ? 6 : 4,
            queued: queue === 'hooks' ? 1 : 10_000,
            weight: 3,
          }),
        };
      },
    });
    await enqueueTenantHooks(input);
    expect(events).toEqual(['ask', 'unit']);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ queue: 'hooks', laneCap: 6, laneWeight: 3 });
    // The app's own definition: the hook is counted at the cap of its queue and never refused.
    expect(enqueued[0]).not.toHaveProperty('queuedCap');
  });

  test('without a cache the hooks get the default lane', async () => {
    const { input, enqueued } = setup(undefined);
    await enqueueTenantHooks(input);
    expect(enqueued[0]).toMatchObject({ queue: 'hooks', laneCap: 4 });
    expect(enqueued[0]).not.toHaveProperty('laneWeight');
  });
});
