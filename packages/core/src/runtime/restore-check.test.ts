import { describe, expect, test, vi } from 'vitest';
import type { ScopeMark } from '../control/scope-mark.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import { restoreCheck } from './restore-check.ts';

const mocked = vi.hoisted(() => ({
  sources: [] as unknown[],
  targets: new Map<string, unknown>(),
  reenqueue: async (): Promise<void> => undefined,
}));
vi.mock('../worker/queue-sources.ts', () => ({ queueSources: async () => mocked.sources }));
vi.mock('./anchor-scopes.ts', () => ({ anchorScopes: async () => mocked.targets }));
vi.mock('../control/reenqueue-unsettled-effects.ts', () => ({
  reenqueueUnsettledEffects: () => mocked.reenqueue(),
}));

const deploymentId = '0192f3a0-0000-7000-8000-0000000000d1';
const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const now = Temporal.Instant.from('2026-11-18T10:00:00Z');

/**
 * A control namespace that holds one tenant's mark at position 5 while the tenant's counters read
 * 3, so the check decides to bump it; the order of what the check did is `steps`.
 */
function setup(options: { readonly failDestroy?: boolean; readonly failReenqueue?: boolean }) {
  const steps: string[] = [];
  const mark: ScopeMark = {
    scopeId: tenantId,
    namespaceId: 'control',
    epoch: 0,
    position: 5n,
    serials: {},
    updatedAt: now,
  };
  const counters: ScopeCounters = { scopeId: tenantId, position: 3n, epoch: 1, serials: {} };
  const adapter = {
    identity: async () => ({ systemId: 's1', timeline: '1' }),
    unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) =>
      fn({
        counters: {
          list: async () => [counters],
          raise: async () => {
            steps.push('raise');
          },
        },
        keys: {
          destroyValueKey: async () => {
            steps.push('destroy');
            if (options.failDestroy === true) throw new Error('the key store is down');
          },
        },
      }),
  };
  const control = {
    namespace: { id: 'control' },
    registry: {},
    capabilities: {},
    adapter,
    epochs: () => new Map<string, number>(),
    identities: { all: async () => [], record: async () => undefined },
    marks: {
      bumped: async () => [],
      list: async () => [mark],
      raise: async () => undefined,
      bump: async (next: ScopeMark) => {
        steps.push('bump');
        return next.epoch;
      },
    },
    ledger: {
      find: async () => [
        {
          seq: 1n,
          record: {
            type: 'keyTombstone',
            scopeId: tenantId,
            keyId: 'v1',
            recordedAt: '2026-11-12T08:00:01.000Z',
            reason: 'rotation',
          },
        },
      ],
      unfinished: async () => ({ erasures: [], head: 0n }),
      append: async () => 1n,
    },
  };
  const source = {
    namespace: control.namespace,
    handle: { adapter, capabilities: {} },
    registry: {},
  };
  mocked.sources = [source];
  mocked.targets = new Map([
    [
      tenantId,
      {
        scope: { level: 'tenant', backendId: 'b1', tenantId },
        namespace: control.namespace,
        handle: source.handle,
      },
    ],
  ]);
  mocked.reenqueue = async () => {
    steps.push('reenqueue');
    if (options.failReenqueue === true) throw new Error('the job store is down');
  };
  const run = () =>
    restoreCheck({
      connected: { control, deploymentId, keys: { invalidate: () => undefined } },
      migrated: {
        directory: {
          lookup: {
            tenant: async (id: string) => ({ id, backendId: 'b1', namespace: control.namespace }),
            backend: async () => undefined,
          },
        },
      },
      served: [],
      sinks: [],
      clock: { now: () => now },
      log: {
        warn: () => undefined,
        info: () => undefined,
        debug: () => undefined,
        error: () => undefined,
      },
    } as never);
  return { run, steps };
}

describe('the order of the restore check', () => {
  test('the effects and the value keys come before the bump', async () => {
    const kit = setup({});
    const { bumps } = await kit.run();
    expect(bumps).toHaveLength(1);
    expect(kit.steps).toEqual(['destroy', 'reenqueue', 'bump', 'raise']);
  });

  test('a failing re-enqueue fails the start before any epoch moves', async () => {
    const kit = setup({ failReenqueue: true });
    await expect(kit.run()).rejects.toThrow('the job store is down');
    expect(kit.steps).not.toContain('bump');
    expect(kit.steps).not.toContain('raise');
  });

  test('a failing key destroy fails the start before any epoch moves', async () => {
    const kit = setup({ failDestroy: true });
    await expect(kit.run()).rejects.toThrow('the key store is down');
    expect(kit.steps).not.toContain('bump');
    expect(kit.steps).not.toContain('reenqueue');
  });
});
