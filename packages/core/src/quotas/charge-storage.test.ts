import { describe, expect, test } from 'vitest';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import { chargeStorage } from './charge-storage.ts';
import type { QuotaLimit } from './quota-limit.ts';
import type { QuotaLimits } from './quota-limits.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b', tenantId: 't' };
const registry = { quotas: new Map() } as unknown as Registry;

function written(created: boolean, tenancy: 'tenant' | 'invocation'): WrittenRow {
  return { created, entry: { descriptor: { tenancy } }, events: [] } as unknown as WrittenRow;
}

const limits = (answer: QuotaLimit): QuotaLimits => ({
  limitOf: () => answer,
  queueOf: () => ({ running: 4, queued: 10, weight: 1 }),
  fresh: async () => undefined,
});

describe('chargeStorage', () => {
  test('counts the created rows of entities that are not per invocation', () => {
    const charges = chargeStorage({
      registry,
      scope: tenant,
      written: [written(true, 'tenant'), written(true, 'invocation'), written(false, 'tenant')],
      quotas: undefined,
      exempt: false,
    });
    expect(charges).toEqual([{ dimension: 'core.rows', delta: 1n, limit: null }]);
  });

  test('charges no bytes of its own: the adapter counts the records it stores', () => {
    const charges = chargeStorage({
      registry,
      scope: tenant,
      written: [written(false, 'tenant')],
      quotas: undefined,
      exempt: false,
    });
    expect(charges).toEqual([]);
  });

  test('declares the byte limit as a charge of zero, so the tail refuses what the unit stored', () => {
    const charges = chargeStorage({
      registry,
      scope: tenant,
      written: [written(false, 'tenant')],
      quotas: limits({ kind: 'bytes', value: 900 }),
      exempt: false,
    });
    expect(charges).toEqual([{ dimension: 'core.eventBytes', delta: 0n, limit: 900n }]);
  });

  test('without quotas and for an exempt action there is no limit', () => {
    const input = { registry, scope: tenant, written: [written(true, 'tenant')] };
    const exempt = chargeStorage({
      ...input,
      quotas: limits({ kind: 'count', value: 5 }),
      exempt: true,
    });
    const none = chargeStorage({ ...input, quotas: undefined, exempt: false });
    expect(exempt).toEqual([{ dimension: 'core.rows', delta: 1n, limit: null }]);
    expect(none).toEqual(exempt);
  });

  test("the limit is the tenant's resolved value as a bigint", () => {
    const charges = chargeStorage({
      registry,
      scope: tenant,
      written: [written(true, 'tenant')],
      quotas: limits({ kind: 'count', value: 7 }),
      exempt: false,
    });
    expect(charges.map((charge) => charge.limit)).toEqual([7n, 7n]);
  });

  test('a rate limit for a storage dimension is internal', () => {
    expect(() =>
      chargeStorage({
        registry,
        scope: tenant,
        written: [written(true, 'tenant')],
        quotas: limits({ kind: 'rate', capacity: 1, refillPerSecond: 1 }),
        exempt: false,
      }),
    ).toThrow(expect.objectContaining({ kind: 'internal', code: 'core.internal' }));
  });

  test('a deployment scope charges nothing', () => {
    expect(
      chargeStorage({
        registry,
        scope: { level: 'deployment' },
        written: [written(true, 'tenant')],
        quotas: limits({ kind: 'count', value: 1 }),
        exempt: false,
      }),
    ).toEqual([]);
  });
});
