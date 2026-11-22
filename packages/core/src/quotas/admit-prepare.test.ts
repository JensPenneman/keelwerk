import { describe, expect, test } from 'vitest';
import type { Registry } from '../registry/registry.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import { admitPrepare } from './admit-prepare.ts';
import type { QuotaView } from './quota-view.ts';

// The admission against a double of the adapter that records how it was asked for its unit. What
// decides each case: the answer of the call and the options the unit was opened with.

const registry = { entities: new Map() } as unknown as Registry;
const noLimit: QuotaView = {
  limitOf: (_registry, _scope, ref) =>
    ref === 'core.rows' ? { kind: 'count', value: 0 } : { kind: 'bytes', value: 0 },
  queueOf: () => ({ running: 4, queued: 10, weight: 1 }),
};

/** A run of a command with `prepare` of `module`, whose tenant stands above both limits. */
function runOf(module: string) {
  const opened: (UnitOptions | undefined)[] = [];
  const unit = {
    receipts: { get: async () => undefined },
    usage: { get: async () => 5n },
    rows: { findOne: async () => undefined },
  };
  const input = {
    action: { module, prepare: () => undefined },
    registry,
    scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
    quotas: noLimit,
    clock: { now: () => Temporal.Instant.from('2026-03-01T00:00:00Z') },
    namespace: { id: 'n' },
    commandId: '00000000-0000-7000-8000-000000000001',
    adapter: {
      unit: async (
        _namespace: unknown,
        _scope: unknown,
        work: (u: unknown) => unknown,
        o?: UnitOptions,
      ) => {
        opened.push(o);
        return work(unit);
      },
    },
  } as unknown as RunCommandInput;
  return { input, opened };
}

describe('admitPrepare', () => {
  test('a core action is exempt: it is let through above both limits and opens no unit', async () => {
    const { input, opened } = runOf('core');
    expect(await admitPrepare(input)).toBe(input);
    expect(opened).toEqual([]);
  });

  test('another module is refused above its limits, in a read-only unit that never waits for a read-write one', async () => {
    const { input, opened } = runOf('library');
    await expect(admitPrepare(input)).rejects.toMatchObject({ code: 'core.quota_exceeded' });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ readOnly: true });
  });
});
