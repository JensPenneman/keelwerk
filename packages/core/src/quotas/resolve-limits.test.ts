import { describe, expect, test } from 'vitest';
import type { QuotaRow } from '../control/control-quotas.ts';
import type { QuotaEntry } from '../registry/quota-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { quotaSlotOf } from './quota-slot-of.ts';
import { resolveLimits } from './resolve-limits.ts';

const rows: QuotaEntry = {
  ref: 'shop.rows',
  module: 'shop',
  name: 'rows',
  kind: 'count',
  default: 50,
  level: 'tenant',
};
const rate: QuotaEntry = {
  ...rows,
  ref: 'shop.rate',
  name: 'rate',
  kind: 'rate',
  default: '60/1m',
};
const backend: Scope = { level: 'backend', backendId: 'b1' };
const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const noValues: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();

function configured(values: Record<string, string>) {
  return new Map([['b1', new Map(Object.entries(values))]]);
}

function row(
  dimension: string,
  tenantId: string,
  limit: string | null,
  version = 1,
): readonly [string, QuotaRow] {
  const slot = quotaSlotOf(dimension, 'b1', tenantId);
  return [slot, { id: `qta-${slot}`, slot, dimension, backendId: 'b1', tenantId, limit, version }];
}

describe('resolveLimits', () => {
  test('a tenant row, else the configured value of the backend, else the declared default', () => {
    const entry = rows;
    const none = new Map<string, QuotaRow>();
    const stored = new Map([row('shop.rows', 't1', '30')]);
    const values = configured({ 'shop.rows': '40' });
    expect(resolveLimits({ entry, scope: tenant, rows: stored, backendQuotas: values })).toEqual({
      kind: 'count',
      value: 30,
    });
    expect(resolveLimits({ entry, scope: tenant, rows: none, backendQuotas: values })).toEqual({
      kind: 'count',
      value: 40,
    });
    expect(resolveLimits({ entry, scope: tenant, rows: none, backendQuotas: noValues })).toEqual({
      kind: 'count',
      value: 50,
    });
  });

  test('a tenant value above the backend value is clamped member by member', () => {
    const counts = new Map([row('shop.rows', 't1', '90')]);
    expect(
      resolveLimits({
        entry: rows,
        scope: tenant,
        rows: counts,
        backendQuotas: configured({ 'shop.rows': '40' }),
      }),
    ).toEqual({ kind: 'count', value: 40 });
    // Capacity above and refill below the backend's bucket: each member takes its own minimum.
    const rates = new Map([row('shop.rate', 't1', '120/10m')]);
    expect(
      resolveLimits({
        entry: rate,
        scope: tenant,
        rows: rates,
        backendQuotas: configured({ 'shop.rate': '60/1m' }),
      }),
    ).toEqual({ kind: 'rate', capacity: 60, refillPerSecond: 0.2 });
  });

  test('backend scope reads the configured value, deployment scope the default', () => {
    const stored = new Map([row('shop.rows', 't1', '30')]);
    const values = configured({ 'shop.rows': '40' });
    expect(
      resolveLimits({ entry: rows, scope: backend, rows: stored, backendQuotas: values }),
    ).toEqual({ kind: 'count', value: 40 });
    expect(
      resolveLimits({
        entry: rows,
        scope: { level: 'deployment' },
        rows: stored,
        backendQuotas: values,
      }),
    ).toEqual({ kind: 'count', value: 50 });
  });

  test('a configured value of another backend or dimension is not read', () => {
    const values = new Map([
      ['b2', new Map([['shop.rows', '5']])],
      ['b1', new Map([['shop.other', '6']])],
    ]);
    expect(
      resolveLimits({ entry: rows, scope: backend, rows: new Map(), backendQuotas: values }),
    ).toEqual({ kind: 'count', value: 50 });
  });

  test('a row without a limit is no override', () => {
    const stored = new Map([row('shop.rows', 't1', null)]);
    expect(
      resolveLimits({
        entry: rows,
        scope: tenant,
        rows: stored,
        backendQuotas: configured({ 'shop.rows': '40' }),
      }),
    ).toEqual({ kind: 'count', value: 40 });
  });

  test('a row that does not parse is skipped and reported', () => {
    const stored = new Map([row('shop.rows', 't1', 'lots', 3)]);
    const skipped: [QuotaRow, unknown][] = [];
    const limit = resolveLimits({
      entry: rows,
      scope: tenant,
      rows: stored,
      backendQuotas: configured({ 'shop.rows': '40' }),
      skipped: (skippedRow, error) => skipped.push([skippedRow, error]),
    });
    expect(limit).toEqual({ kind: 'count', value: 40 });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.[0]).toMatchObject({ tenantId: 't1', version: 3 });
    expect(skipped[0]?.[1]).toBeInstanceOf(Error);
  });

  test('a legacy row of the form <dimension>@<backend> is ignored', () => {
    const slot = 'shop.rows@b1';
    const legacy = new Map<string, QuotaRow>([
      [
        slot,
        {
          id: 'qta-1',
          slot,
          dimension: 'shop.rows',
          backendId: 'b1',
          tenantId: null,
          limit: '5',
          version: 1,
        },
      ],
    ]);
    expect(
      resolveLimits({ entry: rows, scope: backend, rows: legacy, backendQuotas: noValues }),
    ).toEqual({ kind: 'count', value: 50 });
    expect(
      resolveLimits({ entry: rows, scope: tenant, rows: legacy, backendQuotas: noValues }),
    ).toEqual({ kind: 'count', value: 50 });
  });

  test('a row that does not match its slot, or names no tenant, is skipped and ignored', () => {
    const slot = quotaSlotOf('shop.rows', 'b1', 't1');
    const base = {
      id: 'qta-1',
      slot,
      dimension: 'shop.rows',
      backendId: 'b1',
      limit: '5',
      version: 1,
    };
    for (const forged of [
      { ...base, tenantId: null },
      { ...base, tenantId: 't2' },
      { ...base, tenantId: 't1', backendId: 'b2' },
      { ...base, tenantId: 't1', dimension: 'shop.other' },
    ] as const) {
      const skipped: QuotaRow[] = [];
      const limit = resolveLimits({
        entry: rows,
        scope: tenant,
        rows: new Map([[slot, forged]]),
        backendQuotas: noValues,
        skipped: (skippedRow) => skipped.push(skippedRow),
      });
      expect(limit).toEqual({ kind: 'count', value: 50 });
      expect(skipped).toEqual([forged]);
    }
  });

  test('a configured text that does not parse is reported and the default serves', () => {
    const skipped: [string, string, unknown][] = [];
    const limit = resolveLimits({
      entry: rows,
      scope: tenant,
      rows: new Map(),
      backendQuotas: configured({ 'shop.rows': 'lots' }),
      skippedValue: (backendId, dimension, error) => skipped.push([backendId, dimension, error]),
    });
    expect(limit).toEqual({ kind: 'count', value: 50 });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.slice(0, 2)).toEqual(['b1', 'shop.rows']);
    expect(skipped[0]?.[2]).toBeInstanceOf(Error);
  });

  test('an entry counted at backend level ignores tenant rows', () => {
    const entry: QuotaEntry = { ...rows, level: 'backend' };
    const stored = new Map([row('shop.rows', 't1', '10')]);
    expect(
      resolveLimits({
        entry,
        scope: tenant,
        rows: stored,
        backendQuotas: configured({ 'shop.rows': '40' }),
      }),
    ).toEqual({ kind: 'count', value: 40 });
  });

  test('a declared default that does not parse is internal', () => {
    const entry: QuotaEntry = { ...rows, default: 'plenty' };
    expect(() =>
      resolveLimits({ entry, scope: tenant, rows: new Map(), backendQuotas: noValues }),
    ).toThrow(expect.objectContaining({ kind: 'internal' }));
  });
});
