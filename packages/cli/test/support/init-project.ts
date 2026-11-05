import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createFakeHost } from './fake-host.ts';
import { repository } from './repository.ts';
import { runCliWith } from './run-cli-with.ts';

/** The packages a project links into its `node_modules`, the way `pnpm install` would. */
const linked = [
  'adapter-postgres',
  'biome-config',
  'cli',
  'client',
  'core',
  'data',
  'testing',
  'transport-http',
];

/** A project made by `keelwerk init`, with the workspace packages linked. */
export interface InitProject {
  readonly root: string;
  readonly scope: string;
  readonly app: string;
  readonly module: string;
}

/** Makes projects in temporary directories and removes them after each test; call it at the top of a test file. */
export function useInitProjects(): () => Promise<InitProject> {
  const made: string[] = [];
  afterEach(async () => {
    for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true });
  });
  return async () => {
    const parent = await mkdtemp(join(tmpdir(), 'keelwerk-init-'));
    made.push(parent);
    const run = await runCliWith(
      ['init', 'shop', '--scope', '@acme'],
      createFakeHost({ cwd: parent }).host,
    );
    if (run.code !== 0) throw new Error(`init failed: ${run.stderr}`);
    const root = join(parent, 'shop');
    await mkdir(join(root, 'node_modules', '@keelwerk'), { recursive: true });
    await mkdir(join(root, 'node_modules', '@acme'), { recursive: true });
    for (const name of linked) {
      await symlink(
        join(repository, 'packages', name),
        join(root, 'node_modules', '@keelwerk', name),
      );
    }
    await mkdir(join(root, 'node_modules', '@types'), { recursive: true });
    await symlink(
      await realpath(join(repository, 'node_modules', '@types', 'node')),
      join(root, 'node_modules', '@types', 'node'),
    );
    await symlink(
      await realpath(join(repository, 'packages', 'cli', 'node_modules', 'vitest')),
      join(root, 'node_modules', 'vitest'),
    );
    await symlink(
      join(root, 'modules', 'starter'),
      join(root, 'node_modules', '@acme', 'module-starter'),
    );
    return { root, scope: '@acme', app: 'shop', module: 'starter' };
  };
}
