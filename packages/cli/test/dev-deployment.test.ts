import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { devDeployment } from '../src/dev/dev-deployment.ts';
import { devEnvOf } from '../src/dev/dev-env.ts';
import { devPathsOf } from '../src/dev/dev-paths.ts';
import { definitionOf } from './support/deployment-definition-of.ts';
import { environmentOf } from './support/environment-of.ts';

const paths = devPathsOf('/work/shop');
const factory = { id: 'postgres', dialect: 'postgres', create: () => undefined };
const sink = { id: 'file', append: () => undefined, read: () => undefined };
const host = { kind: 'httpHost', provides: [], create: () => undefined };

describe('the deployment as dev runs it', () => {
  const dev = devDeployment(
    definitionOf({
      infrastructure: [factory, sink, host],
      placements: {
        main: { adapter: 'postgres', url: 'postgres://db/app' },
        archive: { adapter: 'postgres', url: 'postgres://db/archive', apps: ['shop'] },
      },
    }),
    paths,
  );

  test('puts the control store and every placement on PGlite below .keelwerk/dev-db (S-47)', () => {
    expect(dev.control).toEqual({
      adapter: 'pglite',
      strategy: 'shared-tables',
      url: join('/work/shop', '.keelwerk', 'dev-db', 'control'),
    });
    expect(dev.placements).toEqual({
      main: {
        adapter: 'pglite',
        strategy: 'shared-tables',
        url: join('/work/shop', '.keelwerk', 'dev-db', 'main'),
      },
      archive: {
        adapter: 'pglite',
        strategy: 'shared-tables',
        url: join('/work/shop', '.keelwerk', 'dev-db', 'archive'),
        apps: ['shop'],
      },
    });
  });

  test('swaps the adapter and the ledger sink, keeps the host, and opens the operator socket', () => {
    const ids = dev.infrastructure.map(
      (entry) => (entry as { id?: string; kind?: string }).id ?? (entry as { kind?: string }).kind,
    );
    expect(ids).toEqual(['httpHost', 'pglite', 'schemaPlanner', expect.any(String)]);
    expect(dev.infrastructure).toContain(host);
    expect(dev.infrastructure).not.toContain(factory);
    expect(dev.infrastructure).not.toContain(sink);
    expect(dev.operator?.socket).toBe(join('/work/shop', '.keelwerk', 'dev.sock'));
  });
});

describe('the environment of the app child', () => {
  test('adds the explain stream and keeps a development master key between runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'keelwerk-dev-env-'));
    try {
      const where = devPathsOf(directory);
      const definition = definitionOf();
      const name = 'KW_KEY';
      const first = devEnvOf(definition, environmentOf(['HOME', '/h']), where);
      expect(first).toMatchObject(
        environmentOf(['HOME', '/h'], ['KEELWERK_EXPLAIN', '1'], ['NODE_ENV', 'development']),
      );
      const key = first[name];
      expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32);
      expect(devEnvOf(definition, {}, where)[name]).toBe(key);
      expect((await readFile(where.masterKey, 'utf8')).trim()).toBe(key);
      expect(devEnvOf(definition, environmentOf([name, 'mine']), where)[name]).toBe('mine');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
