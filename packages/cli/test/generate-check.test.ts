import { execFile } from 'node:child_process';
import { readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { demoBase, useScratchProject } from './support/scratch-project.ts';
import { shopSources } from './support/shop-project.ts';

const repository = fileURLToPath(new URL('../../..', import.meta.url));

const newProject = useScratchProject();

const git = promisify(execFile);

/** An app that mounts the module `demo`, so a moved part file reaches the app's surface. */
const mountingApp = `import { type AppType, defineApiVersions, defineApp } from '@keelwerk/core';
import { demo as demoModule } from '../../../packages/module-demo/src/module.generated.ts';

const demoDef = defineApp({
  id: 'demo',
  modules: [demoModule],
  api: defineApiVersions({ '2026-11-04': {} }),
});

export interface Demo extends AppType<typeof demoDef> {}
export const demo: Demo = demoDef;
`;

const pingAction = `import { defineCommand, shape } from '@keelwerk/core';
import { demoBase } from '../base.ts';

export const ping = defineCommand(demoBase, {
  input: shape({}),
  output: shape({}),
  *decide() {
    return { events: [], effects: [], result: {} };
  },
});
`;

const sources = {
  'packages/module-demo/src/base.ts': demoBase,
  'packages/module-demo/src/actions/ping.ts': pingAction,
  'apps/demo/src/app.ts': mountingApp,
};

describe('generate --check', () => {
  test('the repository is current: every artefact of section 13.7 passes', async () => {
    const { runCliWith } = await import('./support/run-cli-with.ts');
    const { createFakeHost } = await import('./support/fake-host.ts');
    const run = await runCliWith(
      ['generate', '--check'],
      createFakeHost({
        cwd: repository,
        files: { [join(repository, 'pnpm-workspace.yaml')]: '' },
      }).host,
    );
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
  }, 120_000);

  test('a project is written once, then passes, and a stale manifest fails naming the move', async () => {
    const project = await newProject();
    await project.write(sources);
    const written = await project.run('generate', '--output', 'text');
    expect(written.stderr).toBe('');
    expect(written.code).toBe(0);
    expect(written.stdout).toContain('packages/module-demo/src/module.generated.ts written');
    expect(written.stdout).toContain('apps/demo/src/keelwerk.generated.ts written');
    expect(written.stdout).toContain(
      'apps/demo/generated/api-surface/demo/2026-11-04.json written',
    );
    expect(written.stdout).toContain('apps/demo/generated/api-surface/demo/ledger.json written');
    expect(written.stdout).toContain('apps/demo/generated/cli/demo/2026-11-04.json written');
    expect((await project.run('generate', '--check', '--output', 'text')).code).toBe(0);
    expect((await project.run('generate', '--output', 'text')).stdout).toBe(
      'every artefact is up to date\n',
    );

    const moved = await project.fork();
    const { root } = moved;
    await rename(
      join(root, 'packages/module-demo/src/actions/ping.ts'),
      join(root, 'packages/module-demo/src/actions/ping-moved.ts'),
    );
    const stale = await moved.run('generate', '--check', '--output', 'text');
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain('demo.ping');
    expect(stale.stderr).toContain('demo.pingMoved');
    expect(stale.stderr).not.toContain('Command failed');
  }, 60_000);

  test('a deleted generated module file is a drift, not a crash', async () => {
    const project = await newProject();
    await project.write(sources);
    expect((await project.run('generate')).code).toBe(0);
    const fresh = await project.fork();
    await rm(join(fresh.root, 'packages/module-demo/src/module.generated.ts'));
    const run = await fresh.run('generate', '--check', '--output', 'text');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('src/app.ts cannot be loaded');
    expect(run.stderr).toContain('module.generated.ts');
    expect(run.stderr).not.toContain('Command failed');
  }, 60_000);

  test('a moved part file changes its reference, and surface diff against the committed base reports it breaking', async () => {
    const project = await newProject();
    await project.write(sources);
    expect((await project.run('generate')).code).toBe(0);
    const inRepository = (...args: string[]) =>
      git(
        'git',
        [
          '-c',
          'commit.gpgsign=false',
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@example.com',
          ...args,
        ],
        {
          cwd: project.root,
        },
      );
    await inRepository('init', '--quiet');
    await inRepository('add', '--all');
    await inRepository('commit', '--quiet', '-m', 'base');

    const moved = await project.fork();
    await rm(join(moved.root, 'packages/module-demo/src/actions/ping.ts'));
    await moved.write({
      'packages/module-demo/src/actions/ping-moved.ts': pingAction.replace(
        'export const ping',
        'export const pingMoved',
      ),
    });
    const regenerated = await moved.run('generate');
    expect(regenerated.stderr).toBe('');
    expect(regenerated.code).toBe(0);
    const diff = await moved.run('surface', 'diff', '--base', 'HEAD', '--output', 'text');
    expect(diff.code).toBe(1);
    expect(diff.stderr).toContain('breaking demo 2026-11-04: demo.ping');
  }, 120_000);

  test('a date declared before the ledger has its entry is a failure naming the next step, and the other files are still written', async () => {
    const project = await newProject();
    await project.write(sources);
    expect((await project.run('generate')).code).toBe(0);
    const ahead = await project.fork();
    await ahead.write({
      'apps/demo/src/app.ts': mountingApp.replace(
        "{ '2026-11-04': {} }",
        "{ '2026-11-04': {}, '2026-12-01': {} }",
      ),
    });
    const run = await ahead.run('generate', '--output', 'text');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      "the head entry is '2026-11-04' but the app declares '2026-12-01'",
    );
    expect(run.stderr).toContain('keelwerk surface version new 2026-12-01');
    expect(run.stdout).toContain('apps/demo/generated/api-surface/demo/2026-12-01.json written');
  }, 60_000);

  test('generate writes no migration file: a changed track is a note naming db generate, and --check fails', async () => {
    const project = await newProject();
    await project.write(shopSources('total'));
    expect((await project.run('generate')).code).toBe(0);
    expect((await project.run('db', 'generate', 'shop', '--name', 'initial')).code).toBe(0);
    const changed = await project.fork();
    await changed.write(shopSources('amount'));
    const run = await changed.run('generate', '--output', 'text');
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('run keelwerk db generate shop --name <name>');
    expect((await changed.fork().then((copy) => copy.run('generate', '--check'))).code).toBe(1);
    expect(
      (await readdir(join(changed.root, 'packages/module-shop/migrations/own'))).toSorted(),
    ).toEqual(['0001-initial.ts', 'snapshot.json']);
  }, 60_000);

  test('an unknown producer is a usage mistake', async () => {
    const project = await newProject();
    await project.write(sources);
    const run = await project.run('generate', '--only', 'nothing');
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Unknown producer "nothing"');
  });
});
