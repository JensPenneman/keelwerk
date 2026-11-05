import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrackSnapshot } from '@keelwerk/data';
import { afterEach, expect, test } from 'vitest';
import { composedModules } from '../src/producers/composed-modules.ts';
import { deriveApps } from '../src/producers/derive-apps.ts';
import { migrationTargets } from '../src/producers/migration-targets.ts';
import { produceMigrationsAgainstSnapshots } from '../src/producers/migrations-against-snapshots.ts';
import { trackOfField } from '../src/producers/track-of-field.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));

test('a module that names optional modules has its contribution and conditional tracks planned and checked', async () => {
  const { apps } = await deriveApps(repository);
  const targets = await migrationTargets(repository, apps, true);
  const auth = targets.filter((target) => target.module === 'auth');
  expect(auth.map((target) => target.track).toSorted()).toEqual([
    'auth',
    'auth->accounts',
    'auth[accounts]',
  ]);
  const directories = auth.map((target) => target.directory.split('/').slice(-2).join('/'));
  expect(directories.toSorted()).toEqual([
    'migrations/own',
    'migrations/to-accounts',
    'migrations/when-accounts',
  ]);
  for (const target of auth) {
    expect(target.committed.snapshot).not.toBeNull();
    expect(target.committed.files.length).toBeGreaterThan(0);
  }
}, 60_000);

const fixtures = fileURLToPath(new URL('./fixtures/modules', import.meta.url));
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('a module is composed with its partners and the modules they require, and several `when` modules name one track', async () => {
  const [paired] = await composedModules(join(fixtures, 'parcels'), true);
  if (paired === undefined) throw new Error('parcels did not compose');
  const tracks = [...buildTrackSnapshot(paired.entries, { trackOfField }).keys()].toSorted();
  expect(tracks).toContain('parcels');
  expect(tracks).toContain('parcels->depots[crews,ledgers]');
  expect(tracks).toContain('parcels[depots,ledgers]');
  const modules = new Set(paired.entries.map((entry) => entry.module));
  expect(modules).toEqual(new Set(['core', 'crews', 'depots', 'ledgers', 'parcels']));
  const [alone] = await composedModules(join(fixtures, 'ledgers'), false);
  expect(new Set(alone?.entries.map((entry) => entry.module))).toEqual(
    new Set(['core', 'crews', 'ledgers']),
  );
});

test('a module that cannot be composed with its partners is a failure of the producer, not a crash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keelwerk-compose-'));
  scratch.push(root);
  const core = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));
  const directory = join(root, 'packages', 'module-clash');
  await mkdir(join(directory, 'src'), { recursive: true });
  await mkdir(join(directory, 'migrations'), { recursive: true });
  await writeFile(join(directory, 'src', 'base.ts'), "export const base = { id: 'clash' };\n");
  await writeFile(
    join(directory, 'src', 'module.generated.ts'),
    `import { defineEntity, defineModule, defineModuleBase, field } from ${JSON.stringify(core)};

const item = defineEntity({ prefix: 'dupe', fields: { name: field.string() } });
const twin = defineEntity({ prefix: 'dupe', fields: { name: field.string() } });
const partner = defineModule(defineModuleBase({ id: 'partner', version: '0.0.0', entities: { item } }), {});
export const clash = defineModule(
  defineModuleBase({ id: 'clash', version: '0.0.0', optional: [partner], entities: { twin } }),
  {},
);
`,
  );
  await expect(composedModules(directory, true)).rejects.toThrow(/cannot be composed/);
  const result = await produceMigrationsAgainstSnapshots(root, [], true);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toMatch(/clash with its optional modules cannot be composed/);
});
