import { describe, expect, test } from 'vitest';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { UnitOptions } from '../storage/unit-options.ts';
import { createControlLeases } from './create-control-leases.ts';

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
          release: async () => {
            calls.push('release');
          },
          total: async () => {
            calls.push('total');
            return 2;
          },
          expire: async () => {
            calls.push('expire');
            return [];
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
  const leases = createControlLeases(adapter, { id: 'ns-control' } as unknown as NamespaceRef);
  return { leases, opened, calls };
}

const lease = { kind: 'topic', scopeId: null, key: 'k', holder: 'h', units: 1 } as const;

describe('createControlLeases', () => {
  test('hold, release and expire each run in a writing deployment unit of the control namespace', async () => {
    const { leases, opened, calls } = over(true);
    expect(await leases.hold(lease, 10_000)).toEqual({ total: 3 });
    await leases.release('topic', 'k', 'h');
    expect(await leases.expire('topic', 10)).toEqual([]);
    expect(calls).toEqual(['hold', 'release', 'expire']);
    expect(opened).toEqual([
      { scope: { level: 'deployment' }, options: undefined },
      { scope: { level: 'deployment' }, options: undefined },
      { scope: { level: 'deployment' }, options: undefined },
    ]);
  });

  test('total runs in a read-only deployment unit', async () => {
    const { leases, opened } = over(true);
    expect(await leases.total('topic', 'k')).toBe(2);
    expect(opened).toEqual([{ scope: { level: 'deployment' }, options: { readOnly: true } }]);
  });

  test('a unit without leases is refused with unsupported', async () => {
    const { leases } = over(false);
    await expect(leases.total('topic', 'k')).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(leases.hold(lease, 1)).rejects.toMatchObject({
      kind: 'unsupported',
      message: 'The control adapter has no lease store.',
    });
  });
});
