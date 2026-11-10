import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEnvironment, DataAdapter, Logger, PlacementConfig } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { pgliteAdapterFactory } from '../src/pglite/index.ts';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};
const environment = {
  deploymentId: 'deployment-1',
  log: logger,
  tracer: {} as AdapterEnvironment['tracer'],
  secrets: { resolve: async () => '' },
  signal: new AbortController().signal,
} as unknown as AdapterEnvironment;

const opened: DataAdapter[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const adapter of opened.splice(0)) await adapter.close(1000);
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function open(placement: Partial<PlacementConfig>): DataAdapter {
  const adapter = pgliteAdapterFactory().create(
    { id: 'main', strategy: 'shared-tables', ...placement },
    environment,
  );
  opened.push(adapter);
  return adapter;
}

async function roleExists(adapter: DataAdapter): Promise<boolean> {
  const answer = await (
    adapter as unknown as {
      asOwner(
        work: (db: {
          query(sql: string, parameters: unknown[]): Promise<{ rows: unknown[] }>;
        }) => Promise<boolean>,
      ): Promise<boolean>;
    }
  ).asOwner(async (database) => {
    const found = await database.query('select 1 from pg_roles where rolname = $1', ['kw_app']);
    return found.rows.length === 1;
  });
  return answer;
}

describe('pgliteAdapterFactory', () => {
  test('a placement without url or with memory:// opens an in-memory database and creates kw_app', {
    timeout: 60_000,
  }, async () => {
    for (const placement of [{}, { url: 'memory://' }]) {
      const adapter = open(placement);
      await adapter.connect();
      expect(await roleExists(adapter)).toBe(true);
    }
  });

  test('a directory url keeps the database across a reopen, created with mode 0700', {
    timeout: 60_000,
  }, async () => {
    const parent = await mkdtemp(join(tmpdir(), 'kw-pglite-factory-'));
    directories.push(parent);
    const directory = join(parent, 'data');
    const first = open({ url: directory });
    await first.connect();
    const identity = await first.identity();
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    await first.close(1000);
    opened.length = 0;
    const second = open({ url: directory });
    await second.connect();
    expect(await second.identity()).toEqual(identity);
  });

  test('a strategy other than shared-tables is refused as unsupported', () => {
    try {
      open({ strategy: 'schema-per-tenant' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).message).toContain('shared-tables');
    }
  });
});
