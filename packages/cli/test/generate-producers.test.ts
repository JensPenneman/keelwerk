import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TransportAdapter } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { cutVersion } from '../src/commands/surface/cut-version.ts';
import type { AppDerivation } from '../src/producers/app-derivation.ts';
import { deriveApps } from '../src/producers/derive-apps.ts';
import { produceTransportArtefacts } from '../src/producers/transport-artefacts.ts';
import { demoApp, useScratchProject } from './support/scratch-project.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const restAdapter = fileURLToPath(
  new URL('../../transport-rest/src/create-rest-adapter.ts', import.meta.url),
);

async function libraryWith(transport: TransportAdapter): Promise<AppDerivation> {
  const { apps } = await deriveApps(repository);
  const library = apps.find((app) => app.app.id === 'library');
  if (library === undefined) throw new Error('the library fixture app was not found');
  const fills = new Map(library.app.registry.fills);
  fills.set('core.transports', [{ fill: transport, bound: false }] as never);
  return { ...library, app: { ...library.app, registry: { ...library.app.registry, fills } } };
}

describe('transport artefacts', () => {
  test('the OpenAPI document comes from the REST adapter, one per API version', async () => {
    const loaded: { createRestAdapter: () => TransportAdapter } = await import(
      pathToFileURL(restAdapter).href
    );
    const library = await libraryWith(loaded.createRestAdapter());
    const produced = await produceTransportArtefacts(repository, [library], true);
    expect(produced.failures).toEqual([]);
    expect(produced.files.map((file) => file.path)).toEqual([
      join(library.directory, 'generated/openapi/library/2026-11-04.json'),
    ]);
    const document = JSON.parse(produced.files[0]?.text ?? '{}') as Record<string, unknown>;
    expect(document.openapi).toBe('3.1.1');
    expect(document['x-keelwerk-generated']).toMatchObject({
      format: 'keelwerk.openapi/1',
      apiVersion: '2026-11-04',
    });
  }, 60_000);

  test('a surface a transport cannot project is a failure and writes no document', async () => {
    const refusing: TransportAdapter = {
      name: 'refusing',
      capabilities: { streaming: [], batching: false, binary: false },
      static: {},
      check: () => [
        {
          code: 'nameCollision',
          transport: 'refusing',
          subject: 'library.book',
          message: 'rename it',
        },
      ],
      artifacts: () => {
        throw new Error('artifacts must not run after a failed check');
      },
      mount: async () => {
        throw new Error('not mounted');
      },
    };
    const produced = await produceTransportArtefacts(
      repository,
      [await libraryWith(refusing)],
      true,
    );
    expect(produced.files).toEqual([]);
    expect(produced.failures).toEqual([
      expect.stringContaining('refusing 2026-11-04: nameCollision library.book: rename it'),
    ]);
  }, 60_000);
});

describe('cutting an API version', () => {
  test('the head entry follows the sources one last time, then the new version is appended', () => {
    const ledger = {
      format: 'keelwerk.ledger/1' as const,
      app: 'demo',
      versions: [
        {
          version: '2026-11-04',
          surfaceHash: 'sha256-old',
          modules: { core: '0.0.0' },
          changes: [],
        },
      ],
    };
    const implied = {
      version: '2026-11-04',
      surfaceHash: 'sha256-new',
      modules: { core: '0.0.0', shop: '0.2.0' },
    };
    const cut = cutVersion(ledger, implied, '2027-01-12', ['health-details']);
    expect(cut.ledger.versions).toEqual([
      { version: '2026-11-04', surfaceHash: 'sha256-new', modules: implied.modules, changes: [] },
      {
        version: '2027-01-12',
        surfaceHash: 'sha256-new',
        modules: implied.modules,
        changes: ['health-details'],
      },
    ]);
    expect(() => cutVersion(ledger, implied, '2026-11-04', [])).toThrow(/cannot be appended/);
  });
});

describe('surface version new', () => {
  const newProject = useScratchProject();

  test('appends the version to the ledger, prints the line for defineApiVersions, and generate --check fails until it is declared', async () => {
    const project = await newProject();
    await project.write({ 'apps/demo/src/app.ts': demoApp });
    expect((await project.run('generate')).code).toBe(0);
    const ledgerPath = join(project.root, 'apps/demo/generated/api-surface/demo/ledger.json');
    const before = JSON.parse(await readFile(ledgerPath, 'utf8')) as {
      versions: { version: string; surfaceHash: string }[];
    };

    const cut = await project.run('surface', 'version', 'new', '2026-12-01', '--app', 'demo');
    expect(cut.code).toBe(0);
    expect(cut.stdout).toContain("add to defineApiVersions of demo: '2026-12-01': {}");
    const after = JSON.parse(await readFile(ledgerPath, 'utf8')) as typeof before;
    expect(after.versions.map((entry) => entry.version)).toEqual(['2026-11-04', '2026-12-01']);
    expect(after.versions[0]).toEqual(before.versions[0]);
    expect(after.versions[1]?.surfaceHash).toBe(before.versions[0]?.surfaceHash);

    const check = await project.run('generate', '--check');
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('ledgerEntryUnknown');
  }, 60_000);

  test('a date out of order, a malformed date and an unknown app are usage mistakes', async () => {
    const project = await newProject();
    await project.write({ 'apps/demo/src/app.ts': demoApp });
    await project.run('generate');
    const stale = await project.run('surface', 'version', 'new', '2026-11-04');
    expect(stale.code).toBe(2);
    expect(stale.stderr).toContain('cannot be appended');
    expect((await project.run('surface', 'version', 'new', '2026-02-30')).code).toBe(2);
    const unknown = await project.run('surface', 'version', 'new', '2027-01-01', '--app', 'nope');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('no app "nope"');
  }, 60_000);
});

describe('surface diff', () => {
  test('against the commit the working tree sits on nothing is breaking', async () => {
    const { createFakeHost } = await import('./support/fake-host.ts');
    const { runCliWith } = await import('./support/run-cli-with.ts');
    const run = await runCliWith(
      ['surface', 'diff', '--base', 'HEAD', '--output', 'text'],
      createFakeHost({ cwd: repository, files: { [join(repository, 'pnpm-workspace.yaml')]: '' } })
        .host,
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
  }, 120_000);

  test('a ref that is no commit is a usage mistake', async () => {
    const { createFakeHost } = await import('./support/fake-host.ts');
    const { runCliWith } = await import('./support/run-cli-with.ts');
    const run = await runCliWith(
      ['surface', 'diff', '--base', 'no-such-ref-anywhere'],
      createFakeHost({ cwd: repository, files: { [join(repository, 'pnpm-workspace.yaml')]: '' } })
        .host,
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('is not a commit');
  }, 120_000);
});
