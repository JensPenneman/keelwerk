import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Artifact } from '@keelwerk/core';
import { coreApiVersions, renderAppGeneratedFile } from '@keelwerk/core';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { AppDerivation } from '../src/producers/app-derivation.ts';
import { produceAppGeneratedFiles } from '../src/producers/app-generated-files.ts';
import { deriveApps } from '../src/producers/derive-apps.ts';
import { runProducers } from '../src/producers/run-producers.ts';
import { typeFragmentsOf } from '../src/producers/type-fragments-of.ts';
import { appById, fragmentProbe, withTransports } from './support/fragment-probes.ts';
import { demoApp, useScratchProject } from './support/scratch-project.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));

let apps: readonly AppDerivation[] = [];

beforeAll(async () => {
  apps = (await deriveApps(repository)).apps;
}, 120_000);

describe('the owning package.json of an app', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
  });

  const manifest = (dependencies: Record<string, string>): string =>
    JSON.stringify({ name: 'x', dependencies });

  /** `outer/package.json` lists the package, `outer/ws` is the workspace and holds the app. */
  async function workspace(
    inner: string | undefined,
  ): Promise<{ outer: string; root: string; app: string }> {
    const outer = await mkdtemp(join(tmpdir(), 'keelwerk-fragment-ws-'));
    made.push(outer);
    const root = join(outer, 'ws');
    const app = join(root, 'apps', 'x');
    await mkdir(app, { recursive: true });
    await writeFile(join(outer, 'package.json'), manifest({ '@keelwerk/data': '1.0.0' }));
    if (inner !== undefined) await writeFile(join(app, 'package.json'), inner);
    return { outer, root, app };
  }

  const imports: Artifact[] = [
    {
      kind: 'type-fragment',
      content: 'export type X = FallbackRow',
      module: '@keelwerk/data',
      names: ['FallbackRow'],
    },
  ];

  async function fragmentsAt(
    root: string,
    directory: string,
  ): Promise<Awaited<ReturnType<typeof typeFragmentsOf>>> {
    const library = withTransports(appById(apps, 'library'), [
      fragmentProbe('probe', () => imports),
    ]);
    const plain = renderAppGeneratedFile({
      appFile: './app.ts',
      appType: library.appType,
      apiVersion: library.app.api?.head ?? coreApiVersions.head,
      hash: '',
      fragments: [],
    });
    return typeFragmentsOf(root, { ...library, directory }, plain);
  }

  test('the manifest of the app is found when the root has a trailing separator or is relative', async () => {
    const { root, app } = await workspace(manifest({ '@keelwerk/data': '1.0.0' }));
    for (const spelled of [`${root}/`, relative(process.cwd(), root)]) {
      const found = await fragmentsAt(spelled, app);
      expect(found.failures, spelled).toEqual([]);
      expect(found.fragments, spelled).toHaveLength(1);
    }
  }, 60_000);

  test('the walk stops at the workspace root, whatever the way the root is written', async () => {
    const { root, app } = await workspace(undefined);
    for (const spelled of [root, `${root}/`, relative(process.cwd(), root)]) {
      const found = await fragmentsAt(spelled, app);
      expect(found.failures, spelled).toContainEqual(
        expect.stringContaining('no package.json owns the app'),
      );
      expect(found.fragments, spelled).toEqual([]);
    }
  }, 60_000);

  test('an app outside the workspace is refused', async () => {
    const { outer, root } = await workspace(undefined);
    const found = await fragmentsAt(root, outer);
    expect(found.failures).toContainEqual(expect.stringContaining('no package.json owns the app'));
    expect(found.fragments).toEqual([]);
  }, 60_000);

  test.each([
    ['{ not json', 'is not valid JSON'],
    ['null', 'is not a JSON object'],
    ['[]', 'is not a JSON object'],
  ])(
    'a package.json that is %s is a failure naming the file and the fault, not a throw',
    async (text, wording) => {
      const { root, app } = await workspace(text);
      const found = await fragmentsAt(root, app);
      expect(found.failures).toEqual([
        expect.stringContaining(`library: apps/x/package.json ${wording}`),
      ]);
      expect(found.fragments).toEqual([]);
    },
    60_000,
  );

  test('the producer goes on after a malformed package.json: the app has no file, the others do', async () => {
    const { root, app } = await workspace('{ not json');
    const library = withTransports(appById(apps, 'library'), [
      fragmentProbe('probe', () => imports),
    ]);
    const other = appById(apps, 'transport');
    const produced = await produceAppGeneratedFiles(root, [{ ...library, directory: app }, other]);
    expect(produced.failures).toContainEqual(expect.stringContaining('is not valid JSON'));
    expect(produced.files.map((file) => file.path)).toEqual([
      join(other.directory, 'src', 'keelwerk.generated.ts'),
    ]);
  }, 60_000);
});

describe('runProducers over a project with a fragment transport', () => {
  const newProject = useScratchProject();

  const appWith = (fragment: string): string =>
    demoApp
      .replace(
        "import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';",
        "import { type AppType, defineApiVersions, defineApp, defineTransportModule } from '@keelwerk/core';",
      )
      .replace(
        'modules: [],',
        `modules: [defineTransportModule({ id: 'probe', transport: { name: 'probe', capabilities: { streaming: [], batching: false, binary: false }, static: {}, check: () => [], artifacts: () => [${fragment}], mount: async () => { throw new Error('not mounted'); } } })],`,
      );

  const fragment = (module: string, content = 'export type Seen = FallbackRow'): string =>
    `{ kind: 'type-fragment', content: '${content}', module: '${module}', names: ['FallbackRow'] }`;

  const manifestText = JSON.stringify({
    name: 'demo',
    dependencies: {
      '@keelwerk/client': '1.0.0',
      '@keelwerk/core': '1.0.0',
      '@keelwerk/data': '1.0.0',
    },
  });

  const run = async (root: string, check: boolean): ReturnType<typeof runProducers> =>
    runProducers({ root, check, only: ['app'] });

  test.each([
    ['a stale fragment', fragment('@keelwerk/data', 'export type Seen = FallbackRow | null')],
    ['a stale import', fragment('@keelwerk/client')],
  ])(
    '%s fails the check and names the file',
    async (_name, changed) => {
      const project = await newProject();
      await project.write({
        'apps/demo/src/app.ts': appWith(fragment('@keelwerk/data')),
        'apps/demo/package.json': manifestText,
      });
      const first = await run(project.root, false);
      expect(first.failures).toEqual([]);
      expect(first.written).toContainEqual(expect.stringContaining('keelwerk.generated.ts'));
      const written = await readFile(
        join(project.root, 'apps/demo/src/keelwerk.generated.ts'),
        'utf8',
      );
      expect(written).toContain('export type Seen = FallbackRow;');
      expect((await run(project.root, true)).failures).toEqual([]);
      const forked = await project.fork();
      await forked.write({ 'apps/demo/src/app.ts': appWith(changed) });
      const checked = await run(forked.root, true);
      expect(checked.failures).toContainEqual(
        expect.stringMatching(/apps\/demo\/src\/keelwerk\.generated\.ts.*has drifted/),
      );
    },
    120_000,
  );
});
