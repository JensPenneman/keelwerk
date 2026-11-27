import { expect, test, vi } from 'vitest';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import { reachErasure } from './reach-erasure.ts';
import type { ReachErasureInput } from './reach-erasure-input.ts';

const record = {
  type: 'erasure',
  tenantId: 't',
  subjectId: 'ada',
  commandId: 'c1',
} as unknown as ErasureRecord;

function inputOf(options: { readonly fills: number; readonly shredded: readonly string[] }) {
  const unit = vi.fn(
    async (
      _namespace: unknown,
      _scope: unknown,
      fn: (u: unknown) => Promise<unknown>,
      _options: unknown,
    ) => fn({ keys: { shreddedKeys: async () => options.shredded } }),
  );
  const fills = Array.from({ length: options.fills }, () => ({
    module: 'auth',
    bound: true,
    fill: [],
  }));
  const input = {
    context: {},
    source: { registry: { fills: new Map([['core.erasureReach', fills]]) } },
    target: {
      scope: { level: 'tenant', backendId: 'b', tenantId: 't' },
      namespace: {},
      handle: { adapter: { unit } },
    },
    record,
  } as unknown as ReachErasureInput;
  return { input, unit };
}

test('with no filler the step opens no unit', async () => {
  const { input, unit } = inputOf({ fills: 0, shredded: [] });
  await reachErasure(input);
  expect(unit).not.toHaveBeenCalled();
});

test('once a key of the subject is shredded the step committed before: it reads that and stops', async () => {
  const { input, unit } = inputOf({ fills: 1, shredded: ['key'] });
  await reachErasure(input);
  expect(unit).toHaveBeenCalledOnce();
  expect(unit.mock.calls[0]?.[3]).toEqual({ readOnly: true });
});
