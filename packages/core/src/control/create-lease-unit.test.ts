import { describe, expect, test } from 'vitest';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import { createLeaseUnit } from './create-lease-unit.ts';

interface Opened {
  readonly scope: unknown;
  readonly options: UnitOptions | undefined;
}

function over(withLeases: boolean) {
  const opened: Opened[] = [];
  const calls: string[] = [];
  const unit = withLeases
    ? {
        leases: {
          hold: async () => {
            calls.push('hold');
            return { total: 3 };
          },
        },
      }
    : {};
  const adapter = {
    unit: async (
      _namespace: unknown,
      scope: unknown,
      run: (unit: unknown) => Promise<unknown>,
      options?: UnitOptions,
    ) => {
      opened.push({ scope, options });
      return run(unit);
    },
  } as unknown as DataAdapter;
  const namespace = { id: 'ns-control' } as unknown as NamespaceRef;
  return { leaseUnit: createLeaseUnit(adapter, namespace), opened, calls };
}

const lease = { kind: 'topic', scopeId: null, key: 'k', holder: 'h', units: 1 } as const;

describe('createLeaseUnit', () => {
  test('a lease unit runs every call of its function in one writing deployment unit', async () => {
    const { leaseUnit, opened, calls } = over(true);
    await leaseUnit(async (leases) => {
      await leases.hold(lease, 10_000);
      await leases.hold(lease, 10_000);
    });
    expect(calls).toEqual(['hold', 'hold']);
    expect(opened).toEqual([{ scope: { level: 'deployment' }, options: undefined }]);
  });

  test('a unit without leases is refused with unsupported', async () => {
    const { leaseUnit } = over(false);
    await expect(leaseUnit(async (leases) => leases.total('topic', 'k'))).rejects.toMatchObject({
      kind: 'unsupported',
      message: 'The control adapter has no lease store.',
    });
  });
});
