import type { ScopeKeyWrapper } from '@keelwerk/core';
import type { SqlUnitParts } from '@keelwerk/data';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPostgresInstance } from '../src/create-postgres-instance.ts';
import type { PostgresUnitRequest } from '../src/postgres-unit-request.ts';
import { testEnvironment } from './support/test-environment.ts';
import { testNamespace } from './support/test-namespace.ts';
import { testScopes } from './support/test-scopes.ts';

const seen: PostgresUnitRequest[] = [];

vi.mock('../src/postgres-pool.ts', () => ({
  createPostgresPool: () => ({
    connect: async () => ({ release: () => undefined, query: async () => ({ rows: [] }) }),
    end: async () => undefined,
  }),
}));
vi.mock('../src/check-server-version.ts', () => ({ checkServerVersion: async () => undefined }));
vi.mock('../src/check-role.ts', () => ({ checkRole: async () => undefined }));
vi.mock('../src/postgres-unit.ts', () => ({
  runPostgresUnit: async (request: PostgresUnitRequest) => {
    seen.push(request);
    return undefined;
  },
}));

const wrapper = (): ScopeKeyWrapper => ({}) as unknown as ScopeKeyWrapper;
const placement = { id: 'main', url: 'postgres://x/y', strategy: 'shared-tables' } as const;

async function partsFor(
  option: ScopeKeyWrapper | undefined,
  environment: ScopeKeyWrapper | undefined,
): Promise<SqlUnitParts> {
  const base = testEnvironment();
  const instance = createPostgresInstance(
    option === undefined ? {} : { keyWrapper: option },
    placement,
    environment === undefined ? base : { ...base, keyWrapper: environment },
  );
  await instance.connect();
  await instance.unit(testNamespace, testScopes.scopeA, async () => undefined);
  const request = seen.at(-1);
  if (request === undefined) throw new Error('no unit request was seen');
  return request.parts;
}

describe('the key wrapper of the postgres adapter', () => {
  beforeEach(() => {
    seen.length = 0;
  });

  test('comes from the runtime environment when the option is absent', async () => {
    const fromEnvironment = wrapper();
    expect((await partsFor(undefined, fromEnvironment)).keyWrapper).toBe(fromEnvironment);
  });

  test('comes from the option when both exist', async () => {
    const fromOption = wrapper();
    expect((await partsFor(fromOption, wrapper())).keyWrapper).toBe(fromOption);
  });

  test('is omitted when neither exists', async () => {
    expect('keyWrapper' in (await partsFor(undefined, undefined))).toBe(false);
  });
});
