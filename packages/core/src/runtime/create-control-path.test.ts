import { describe, expect, test } from 'vitest';
import type { FlagTargetingRow } from '../control/control-flags.ts';
import { errors } from '../errors/errors.ts';
import type { Registry } from '../registry/registry.ts';
import type { Connected } from './connected.ts';
import { createControlPath } from './create-control-path.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Migrated } from './migrate-phase.ts';
import type { ServedApp } from './served-app.ts';

const registry = {
  modules: [
    {
      id: 'shop',
      flags: {
        limit: { kind: 'number', level: 'tenant', default: 1, min: 1, max: 5 },
      },
    },
  ],
} as unknown as Registry;

const app = { id: 'main', registry } as unknown as ServedApp;

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const tenants: Readonly<Record<string, { backendId: string }>> = {
  [tenantA]: { backendId: 'b1' },
  [tenantB]: { backendId: 'b2' },
};

function pathOver(rows: readonly FlagTargetingRow[], reads: { count: number } = { count: 0 }) {
  const flags = {
    rows: async () => {
      throw new Error('the restore check reads one row, not every row');
    },
    row: async (id: string) => rows.find((candidate) => candidate.id === id),
  };
  // The tenant rows come from the bare control rows; the directory's `tenant` opens the namespace
  // of the tenant's app, which fails for an app this process does not serve.
  const control = {
    flags,
    entity: (ref: string) => ref,
    read: async (fn: (unit: unknown) => Promise<unknown>) => {
      reads.count += 1;
      return fn({
        rows: {
          find: async (_entity: string, query: { where: { value?: unknown } }) => {
            const id = JSON.stringify(query.where);
            const found = Object.entries(tenants).filter(([key]) => id.includes(key));
            return { rows: found.map(([key, row]) => ({ id: key, ...row })) };
          },
        },
      });
    },
  };
  const connected = { control } as unknown as Connected;
  const lookup = {
    tenant: async () => {
      throw errors.unavailable('App "other" is not served by this process.');
    },
    backend: async (id: string) => (id === 'b1' || id === 'b2' ? { id, app: 'main' } : undefined),
  };
  const migrated = { directory: { lookup } } as unknown as Migrated;
  return createControlPath({
    deployment: {} as unknown as DeploymentDefinition,
    served: [app],
    connected,
    migrated,
  });
}

const serving = (value: number) => ({ enabled: true, rules: [], fallthrough: { value } });
const stored = (extra: Partial<FlagTargetingRow>): FlagTargetingRow => ({
  id: 'flg-1',
  key: 'shop.limit',
  backendId: null,
  version: 2,
  targeting: serving(3),
  ...extra,
});

describe('createControlPath checkFlagRestore', () => {
  test('refuses a previous targeting the current declaration rejects', async () => {
    const path = pathOver([stored({ previous: serving(50) })]);
    await expect(path.checkFlagRestore('flg-1', 2)).rejects.toMatchObject({
      code: 'core.validation',
    });
  });

  test('accepts a previous targeting that fits', async () => {
    await expect(
      pathOver([stored({ previous: serving(4) })]).checkFlagRestore('flg-1', 2),
    ).resolves.toBeUndefined();
  });

  test('passes a row with no previous and an id that is missing', async () => {
    const path = pathOver([stored({})]);
    await expect(path.checkFlagRestore('flg-1', 2)).resolves.toBeUndefined();
    await expect(path.checkFlagRestore('flg-9', 2)).resolves.toBeUndefined();
  });

  test('a row at another version than the one named is a conflict the operator can retry', async () => {
    const path = pathOver([stored({ version: 3, previous: serving(4) })]);
    await expect(path.checkFlagRestore('flg-1', 2)).rejects.toMatchObject({
      kind: 'conflict',
      code: 'core.version_mismatch',
      details: { ifVersion: true },
    });
  });
});

const ruleOf = (extra: object) => ({
  enabled: true,
  rules: [{ id: 'r1', serve: { value: 4 }, ...extra }],
  fallthrough: { value: 1 },
});

describe('createControlPath checkFlagTargeting, the ids a rule lists', () => {
  test('a rule of a deployment-wide row cannot list principals', async () => {
    const path = pathOver([]);
    await expect(
      path.checkFlagTargeting({
        key: 'shop.limit',
        targeting: ruleOf({ principals: ['u-42'] }) as never,
      }),
    ).rejects.toMatchObject({
      code: 'core.validation',
      message: expect.stringContaining('rules[0].principals'),
    });
    await expect(
      path.checkFlagTargeting({
        key: 'shop.limit',
        backendId: 'b1',
        targeting: ruleOf({ principals: ['u-42'] }) as never,
      }),
    ).resolves.toBeUndefined();
  });

  test('a tenant of a backend row must belong to that backend', async () => {
    const path = pathOver([]);
    const check = (id: string, backendId?: string) =>
      path.checkFlagTargeting({
        key: 'shop.limit',
        ...(backendId === undefined ? {} : { backendId }),
        targeting: ruleOf({ tenants: [tenantA, id] }) as never,
      });
    await expect(check(tenantA, 'b1')).resolves.toBeUndefined();
    await expect(check(tenantB, 'b1')).rejects.toMatchObject({
      code: 'core.validation',
      message: expect.stringContaining('rules[0].tenants[1]'),
    });
    await expect(check('33333333-3333-4333-8333-333333333333', 'b1')).rejects.toMatchObject({
      message: expect.stringContaining('rules[0].tenants[1]'),
    });
  });

  test('a tenant of a deployment-wide row must exist', async () => {
    const path = pathOver([]);
    const check = (id: string) =>
      path.checkFlagTargeting({
        key: 'shop.limit',
        targeting: ruleOf({ tenants: [id] }) as never,
      });
    await expect(check(tenantB)).resolves.toBeUndefined();
    await expect(check('33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({
      code: 'core.validation',
      message: expect.stringContaining('rules[0].tenants[0]'),
    });
  });
});

describe('createControlPath checkFlagTargeting, reads of the tenant rows', () => {
  const check = (ids: readonly string[], reads: { count: number }) =>
    pathOver([], reads).checkFlagTargeting({
      key: 'shop.limit',
      targeting: {
        enabled: true,
        rules: [
          { id: 'r1', serve: { value: 4 }, tenants: ids.slice(0, 2) },
          { id: 'r2', serve: { value: 4 }, tenants: ids.slice(1) },
        ],
        fallthrough: { value: 1 },
      } as never,
    });

  test('a write that lists three tenants causes one read', async () => {
    const reads = { count: 0 };
    await check([tenantA, tenantB, tenantA], reads);
    expect(reads.count).toBe(1);
  });

  test('501 distinct ids cause two reads', async () => {
    const reads = { count: 0 };
    const ids = [tenantA, tenantB];
    for (let n = 0; ids.length < 501; n += 1) {
      ids.push(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    }
    await expect(check(ids, reads)).rejects.toMatchObject({ code: 'core.validation' });
    expect(reads.count).toBe(2);
  });
});

describe('createControlPath checkFlagRestore, tenants that are gone', () => {
  const gone = '33333333-3333-4333-8333-333333333333';
  const listing = (id: string) => ({
    enabled: true,
    rules: [{ id: 'r1', serve: { value: 4 }, tenants: [id] }],
    fallthrough: { value: 1 },
  });

  test('a restore to a targeting that lists a tenant that no longer exists succeeds', async () => {
    const path = pathOver([stored({ previous: listing(gone) as never })]);
    await expect(path.checkFlagRestore('flg-1', 2)).resolves.toBeUndefined();
  });

  test('a restore still refuses a tenant of another backend', async () => {
    const path = pathOver([stored({ backendId: 'b1', previous: listing(tenantB) as never })]);
    await expect(path.checkFlagRestore('flg-1', 2)).rejects.toMatchObject({
      code: 'core.validation',
    });
  });
});
