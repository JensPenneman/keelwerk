import { describe, expect, test } from 'vitest';
import type { ScopeMark } from '../control/scope-mark.ts';
import type { ScopeCounters } from '../storage/scope-counters.ts';
import { checkControlNamespace } from './check-control-namespace.ts';

const deploymentId = '0192f3a0-0000-7000-8000-0000000000d1';
const now = Temporal.Instant.from('2026-11-18T10:00:00Z');

/** A control store whose deployment scope has a mark and counters, and what the check wrote. */
function setup(options: { readonly counterPosition: bigint; readonly strayMark?: boolean }) {
  const marks = new Map<string, ScopeMark>([
    [
      deploymentId,
      {
        scopeId: deploymentId,
        namespaceId: 'control',
        epoch: 0,
        position: 5n,
        serials: {},
        updatedAt: now,
      },
    ],
  ]);
  if (options.strayMark === true) {
    marks.set('stray', { ...(marks.get(deploymentId) as ScopeMark), scopeId: 'stray' });
  }
  const raised: ScopeCounters[] = [];
  const recorded: unknown[] = [];
  const warned: unknown[] = [];
  const counters: ScopeCounters[] = [
    { scopeId: deploymentId, position: options.counterPosition, epoch: 1, serials: {} },
  ];
  const control = {
    namespace: { id: 'control' },
    registry: {},
    capabilities: {},
    adapter: {
      identity: async () => ({ systemId: 's1', timeline: '1' }),
      unit: async (_ns: unknown, _scope: unknown, fn: (u: unknown) => unknown) =>
        fn({
          counters: {
            list: async () => counters,
            raise: async (row: ScopeCounters) => {
              raised.push(row);
            },
          },
        }),
    },
    epochs: () => new Map<string, number>(),
    identities: {
      all: async () => [],
      record: async (row: unknown) => {
        recorded.push(row);
      },
    },
    marks: {
      bumped: async () => [],
      list: async () => [...marks.values()],
      bump: async (mark: ScopeMark) => mark.epoch,
      raise: async () => undefined,
    },
  };
  const log = {
    warn: (message: string, fields: unknown) => warned.push({ message, fields }),
    info: () => undefined,
  };
  const run = () =>
    checkControlNamespace({
      control: control as never,
      deploymentId,
      clock: { now: () => now },
      log: log as never,
    });
  return { run, raised, recorded, warned };
}

describe('the restore check of the control namespace in connect', () => {
  test('a deployment scope whose counters lie below its mark is bumped before the boot writes anything', async () => {
    const kit = setup({ counterPosition: 3n });
    const bumps = await kit.run();
    expect(bumps).toEqual([{ scopeId: deploymentId, from: 0, to: 2, reason: 'counter' }]);
    // The counters are raised to the mark's position under the new epoch, so the boot's own writes
    // take positions above everything the deployment scope issued.
    expect(kit.raised).toEqual([{ scopeId: deploymentId, position: 5n, epoch: 2, serials: {} }]);
    expect(kit.warned).toHaveLength(1);
    expect(kit.recorded).toHaveLength(1);
  });

  test('an unchanged control namespace bumps nothing and records its identity', async () => {
    const kit = setup({ counterPosition: 5n });
    expect(await kit.run()).toEqual([]);
    expect(kit.raised).toEqual([]);
    expect(kit.recorded).toHaveLength(1);
  });

  test('a mark of a scope the directory cannot place fails the start: the directory is not open yet', async () => {
    const kit = setup({ counterPosition: 5n, strayMark: true });
    await expect(kit.run()).rejects.toThrow('The scope directory is not open yet.');
  });
});
