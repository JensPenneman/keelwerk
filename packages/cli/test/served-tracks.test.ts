import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AnyModule, DataAdapter, DataAdapterFactory, SchemaPlanner } from '@keelwerk/core';
import { controlNamespace, defineApp, secret, startRuntime } from '@keelwerk/core';
import { memoryAdapter, schemaPlanner } from '@keelwerk/data';
import { expect, test } from 'vitest';
import { buildIdOf } from '../src/db/build-id-of.ts';
import { tracksOfApp } from '../src/db/tracks-of-app.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));

async function moduleOf(directory: string, name: string): Promise<AnyModule> {
  const file = pathToFileURL(`${repository}packages/${directory}/src/module.generated.ts`).href;
  const loaded: Record<string, unknown> = await import(file);
  return loaded[name] as AnyModule;
}

const names = (tracks: readonly { readonly track: string }[]): readonly string[] =>
  tracks.map((track) => track.track);

test('tracksOfApp lists only the tracks the app selects', async () => {
  const auth = await moduleOf('module-auth', 'auth');
  const accounts = await moduleOf('module-accounts', 'accounts');
  const alone = defineApp({ id: 'alone', modules: [auth] as never });
  expect(names(await tracksOfApp(alone))).toEqual(['auth']);
  const both = defineApp({ id: 'both', modules: [accounts, auth] as never });
  expect(names(await tracksOfApp(both))).toEqual([
    'accounts',
    'auth',
    'auth->accounts',
    'auth[accounts]',
  ]);
});

test('one process serving two apps gives each namespace its own tracks, and the build id covers both', async () => {
  const auth = await moduleOf('module-auth', 'auth');
  const accounts = await moduleOf('module-accounts', 'accounts');
  const solo = defineApp({ id: 'solo', modules: [auth] as never });
  const pair = defineApp({ id: 'pair', modules: [accounts, auth] as never });
  const real = schemaPlanner();
  const applied = new Map<string, string[]>();
  const planner: SchemaPlanner = {
    ...real,
    applyPending: async (schema, namespace, tracks) => {
      applied.set(namespace.appId, [...(applied.get(namespace.appId) ?? []), ...names(tracks)]);
      return real.applyPending(schema, namespace, tracks);
    },
  };
  const inner = memoryAdapter();
  let control: DataAdapter | undefined;
  const factory: DataAdapterFactory = {
    ...inner,
    create: (placement, environment) => {
      const adapter = inner.create(placement, environment);
      if (placement.id === 'control') control = adapter;
      return adapter;
    },
  };
  const runtime = await startRuntime(
    {
      apps: [solo, pair],
      infrastructure: [factory, planner],
      control: { adapter: 'memory' },
      placements: { main: { adapter: 'memory', strategy: 'shared-tables' } },
      tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret('KW_TRACKS_KEY') },
    },
    {
      role: 'all',
      listen: false,
      environment: 'test',
      env: Object.fromEntries([['KW_TRACKS_KEY', Buffer.alloc(32, 7).toString('base64')]]),
    },
  );
  try {
    expect([...(applied.get('solo') ?? [])].toSorted()).toEqual(['auth']);
    expect([...(applied.get('pair') ?? [])].toSorted()).toEqual([
      'accounts',
      'auth',
      'auth->accounts',
      'auth[accounts]',
    ]);
    const entity = pair.registry.entities.get('core.process')?.descriptor;
    if (entity === undefined || control === undefined) throw new Error('no control store');
    const processes = await control.unit(
      controlNamespace('control'),
      { level: 'deployment' },
      (unit) => unit.rows.find(entity, {}),
      { readOnly: true },
    );
    expect(processes.rows.map((row) => String(row.buildId))).toEqual([
      await buildIdOf([solo, pair]),
    ]);
  } finally {
    await runtime.stop(1000);
  }
}, 60_000);
