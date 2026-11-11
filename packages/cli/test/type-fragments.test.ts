import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiSurface, Artifact, TransportAdapter } from '@keelwerk/core';
import { beforeAll, describe, expect, test } from 'vitest';
import type { AppDerivation } from '../src/producers/app-derivation.ts';
import { produceAppGeneratedFiles } from '../src/producers/app-generated-files.ts';
import { produceCliManifests } from '../src/producers/cli-manifest.ts';
import { deriveApps } from '../src/producers/derive-apps.ts';
import { reconcileFiles } from '../src/producers/reconcile-files.ts';
import { produceSurfaces } from '../src/producers/surfaces.ts';
import { produceTransportArtefacts } from '../src/producers/transport-artefacts.ts';
import {
  appById,
  type Fragment,
  fragmentProbe,
  withTransports,
} from './support/fragment-probes.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const golden = fileURLToPath(new URL('./generated/library-type-fragments.txt', import.meta.url));

const goldenFragments: Fragment[] = [
  {
    kind: 'type-fragment',
    content: 'export type ProbeEvent = EventOf<App, never>',
    module: '@keelwerk/client',
    names: ['EventOf'],
  },
  {
    kind: 'type-fragment',
    content: 'export type LibraryRows = Row<App, string>',
    module: '@keelwerk/core',
    names: ['Row'],
  },
  {
    kind: 'type-fragment',
    content: 'export type Fallback = FallbackRow',
    module: '@keelwerk/data',
    names: ['FallbackRow'],
  },
];

const declareOne: Artifact[] = [{ kind: 'type-fragment', content: 'export type One = 1' }];

let apps: readonly AppDerivation[] = [];

beforeAll(async () => {
  apps = (await deriveApps(repository)).apps;
}, 120_000);

async function libraryFile(
  transports: readonly TransportAdapter[],
): Promise<{ text: string | undefined; failures: readonly string[] }> {
  const library = withTransports(appById(apps, 'library'), transports);
  const produced = await produceAppGeneratedFiles(repository, [library]);
  const path = join(library.directory, 'src', 'keelwerk.generated.ts');
  return {
    text: produced.files.find((file) => file.path === path)?.text,
    failures: produced.failures,
  };
}

async function goldenBody(): Promise<string> {
  return readFile(golden, 'utf8');
}

describe('type fragments in the generated app file', () => {
  test("golden: the head surface's fragments join the imports and follow the six type exports", async () => {
    const produced = await libraryFile([fragmentProbe('probe', () => goldenFragments)]);
    expect(produced.failures).toEqual([]);
    const committed = await readFile(
      join(appById(apps, 'library').directory, 'src', 'keelwerk.generated.ts'),
      'utf8',
    );
    const [header, ...rest] = (produced.text ?? '').split('\n');
    expect(header).toBe(committed.split('\n')[0]);
    expect(rest.join('\n')).toBe(await goldenBody());
  }, 60_000);

  test('fragments come in declaration-text order whatever the mount order', async () => {
    const a = fragmentProbe('a', () => [goldenFragments[0] as Fragment]);
    const b = fragmentProbe('b', () => goldenFragments.slice(1));
    const forward = await libraryFile([a, b]);
    const backward = await libraryFile([b, a]);
    expect(forward.failures).toEqual([]);
    expect(forward.text).toBeDefined();
    expect(backward.text).toBe(forward.text);
  }, 60_000);

  test('without fragments every committed keelwerk.generated.ts is what the producer writes', async () => {
    const produced = await produceAppGeneratedFiles(repository, apps);
    expect(produced.failures).toEqual([]);
    for (const id of ['library', 'transport', 'versioned', 'conformance', 'vault', 'portal']) {
      const app = appById(apps, id);
      const path = join(app.directory, 'src', 'keelwerk.generated.ts');
      const file = produced.files.find((item) => item.path === path);
      expect(file, id).toBeDefined();
      expect(file?.text, id).toBe(await readFile(path, 'utf8'));
    }
  }, 60_000);

  test('only the head surface gives fragments: the committed files of an older version do not change', async () => {
    const versioned = appById(apps, 'versioned');
    const seen = (surface: ApiSurface): Artifact[] => [
      {
        kind: 'file',
        contentType: 'text/plain',
        path: `generated/probe/${surface.apiVersion}.txt`,
        content: surface.apiVersion,
      },
      { kind: 'type-fragment', content: `export type Seen = '${surface.apiVersion}'` },
    ];
    const withFragment = withTransports(versioned, [fragmentProbe('seen', seen)]);
    const produced = await produceAppGeneratedFiles(repository, [withFragment]);
    expect(produced.failures).toEqual([]);
    const text = produced.files[0]?.text ?? '';
    expect(text).toContain("export type Seen = '2026-11-11';");
    expect(text).not.toContain('2026-11-04');
    const surfaces = await produceSurfaces(repository, [withFragment], true);
    const documents = await produceTransportArtefacts(repository, [withFragment], true);
    const manifests = await produceCliManifests(repository, [withFragment], true);
    const older = [...surfaces.files, ...documents.files, ...manifests.files].filter((file) =>
      file.path.includes('2026-11-04'),
    );
    for (const path of [
      'generated/api-surface/versioned/2026-11-04.json',
      'generated/cli/versioned/2026-11-04.json',
      'generated/probe/2026-11-04.txt',
    ]) {
      expect(older.map((file) => file.path)).toContainEqual(join(versioned.directory, path));
    }
    for (const file of older.filter((item) => !item.path.includes('/probe/'))) {
      expect(file.text, file.path).toBe(await readFile(file.path, 'utf8'));
    }
  }, 60_000);

  async function driftOf(edit: (text: string) => string): Promise<readonly string[]> {
    const produced = await libraryFile([fragmentProbe('probe', () => goldenFragments)]);
    const directory = await mkdtemp(join(tmpdir(), 'keelwerk-fragment-drift-'));
    const path = join(directory, 'src', 'keelwerk.generated.ts');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, produced.text ?? '');
    const stale = await reconcileFiles(
      directory,
      [{ path, text: edit(produced.text ?? '') }],
      true,
    );
    return stale.failures;
  }

  test('a stale fragment fails the drift check', async () => {
    const failures = await driftOf((text) =>
      text.replace('EventOf<App, never>', 'EventOf<App, string>'),
    );
    expect(failures).toContainEqual(expect.stringContaining('has drifted'));
  }, 60_000);

  test('a missing import fails the drift check', async () => {
    const failures = await driftOf((text) =>
      text.replace("import type { FallbackRow } from '@keelwerk/data';\n", ''),
    );
    expect(failures).toContainEqual(expect.stringContaining('has drifted'));
  }, 60_000);

  const declare = (content: string, extra: Partial<Fragment> = {}): Fragment[] => [
    { kind: 'type-fragment', content, ...extra },
  ];
  const long = `export type ${'A'.repeat(86)} = 1`;
  test.each<[string, Fragment[], string]>([
    ['names without module', declare('export type A = B', { names: ['B'] }), 'without a module'],
    [
      'module without names',
      declare('export type A = 1', { module: '@keelwerk/core' }),
      'imports nothing from',
    ],
    [
      'a bad name',
      declare('export type A = 1', { module: '@keelwerk/core', names: ['a b'] }),
      'no name or',
    ],
    ...['./types.ts', '../shared/src/x.ts', '/abs/x', 'node:fs', '@keelwerk/core/wire'].map(
      (module): [string, Fragment[], string] => [
        `module ${module}`,
        declare('export type A = B', { module, names: ['B'] }),
        'is no package name',
      ],
    ),
    [
      'an unlisted package',
      declare('export type A = B', { module: '@keelwerk/transport-rest', names: ['B'] }),
      'packages/testing/package.json does not list in dependencies',
    ],
    ['two lines', declare('export type A = 1\nexport type B = 2'), 'one line'],
    ['trailing semicolon', declare('export type A = 1;'), 'one line'],
    ['two statements', declare('export type A = 1; export type B = 2'), 'one line'],
    ['no export', declare('type A = 1'), 'one line'],
    ['an interface', declare('export interface A {}'), 'one line'],
    ['100 characters', declare(`${long}0`), 'one line'],
    [
      'an unused import',
      declare('export type A = 1', { module: '@keelwerk/core', names: ['Row'] }),
      'Row from @keelwerk/core without using it',
    ],
    ['declares Client', declare('export type Client = 1'), 'declares Client'],
    ['declares Row', declare('export type Row = 1'), 'declares Row'],
    [
      'imports Row from another module',
      declare('export type A = Row', { module: '@keelwerk/data', names: ['Row'] }),
      'import Row from @keelwerk/core and @keelwerk/data',
    ],
    [
      'imports a generated declaration',
      declare('export type X = ActionRef', { module: '@keelwerk/core', names: ['ActionRef'] }),
      'imports ActionRef, which',
    ],
    [
      'binds one name twice',
      declare('export type X = Row', { module: '@keelwerk/core', names: ['AppClient as Row'] }),
      'import Row from @keelwerk/core and @keelwerk/core',
    ],
    [
      'imports its own declared name',
      declare('export type FallbackRow = FallbackRow', {
        module: '@keelwerk/data',
        names: ['FallbackRow'],
      }),
      'imports FallbackRow, which',
    ],
  ])(
    'refused: %s',
    async (_name, artifacts, expected) => {
      const produced = await libraryFile([fragmentProbe('probe', () => artifacts)]);
      expect(produced.failures).toContainEqual(expect.stringContaining(expected));
      expect(produced.text).toBeUndefined();
    },
    60_000,
  );

  test('a name with a dollar sign counts as used', async () => {
    const produced = await libraryFile([
      fragmentProbe('probe', () =>
        declare('export type X = $Y', { module: '@keelwerk/data', names: ['$Y'] }),
      ),
    ]);
    expect(produced.failures.join('\n')).not.toContain('without using it');
  }, 60_000);

  test('two writers of one declaration name fail the producer and write no file', async () => {
    const a = fragmentProbe('a', () => declare('export type ProbeEvent = 1'));
    const b = fragmentProbe('b', () => declare('export type ProbeEvent = 2'));
    const produced = await libraryFile([a, b]);
    expect(
      produced.failures.filter((line) => line.includes('two type fragments declare ProbeEvent')),
    ).toHaveLength(1);
    expect(produced.text).toBeUndefined();
  }, 60_000);

  test('a fragment without an import is written without a new import line', async () => {
    const produced = await libraryFile([
      fragmentProbe('probe', () => declare('export type Rows = RowOf<string>')),
    ]);
    const committed = await readFile(
      join(appById(apps, 'library').directory, 'src', 'keelwerk.generated.ts'),
      'utf8',
    );
    const importsOf = (text: string): string[] =>
      text.split('\n').filter((line) => line.startsWith('import'));
    expect(importsOf(produced.text ?? '')).toEqual(importsOf(committed));
    expect(produced.text).toContain('export type Rows = RowOf<string>;');
  }, 60_000);

  test('a transport that cannot project the head gives a failure and its artefacts are not asked for', async () => {
    const refusing: TransportAdapter = {
      ...fragmentProbe('refusing', () => {
        throw new Error('artifacts must not run after a failed check');
      }),
      check: () => [{ code: 'nameCollision', transport: 'refusing', subject: 'x', message: 'no' }],
    };
    const produced = await libraryFile([refusing]);
    expect(produced.failures).toContainEqual(
      expect.stringContaining('the transport cannot project the head surface'),
    );
    expect(produced.text).toBeUndefined();
  }, 60_000);

  test("the head surface's artefacts are derived once however many producers read them", async () => {
    const calls = { check: 0, artifacts: 0 };
    const counting: TransportAdapter = {
      ...fragmentProbe('counting', () => {
        calls.artifacts += 1;
        return declareOne;
      }),
      check: () => {
        calls.check += 1;
        return [];
      },
    };
    const library = withTransports(appById(apps, 'library'), [counting]);
    await produceAppGeneratedFiles(repository, [library]);
    await produceTransportArtefacts(repository, [library], true);
    expect(calls).toEqual({ check: library.surfaces.length, artifacts: library.surfaces.length });
  }, 60_000);
});
