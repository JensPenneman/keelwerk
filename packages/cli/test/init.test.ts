import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { useInitProjects } from './support/init-project.ts';
import { repository } from './support/repository.ts';
import { runCliWith } from './support/run-cli-with.ts';

const execFileAsync = promisify(execFile);
const project = useInitProjects();
const scratch: string[] = [];

afterEach(async () => {
  for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function listing(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.parentPath.includes('node_modules'))
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .toSorted();
}

async function emptyDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'keelwerk-init-'));
  scratch.push(directory);
  return directory;
}

describe('init', () => {
  test('writes the canonical layout of section 23.1 with one app and one module', async () => {
    const cwd = await emptyDirectory();
    const run = await runCliWith(
      ['init', 'my-platform', '--scope', '@acme'],
      createFakeHost({ cwd }).host,
    );
    expect(run.code).toBe(0);
    expect(await listing(join(cwd, 'my-platform'))).toEqual([
      '.gitignore',
      '.launchway/compose.yaml',
      '.launchway/deployment.ts',
      '.launchway/launchway.ts',
      '.launchway/tsconfig.json',
      'apps/my-platform/package.json',
      'apps/my-platform/src/app.test-d.ts',
      'apps/my-platform/src/app.ts',
      'apps/my-platform/src/modules.ts',
      'apps/my-platform/tsconfig.json',
      'apps/my-platform/tsconfig.test.json',
      'biome.json',
      'knip.json',
      'modules/starter/package.json',
      'modules/starter/src/base.ts',
      'modules/starter/src/module.generated.ts',
      'modules/starter/src/module.test-d.ts',
      'modules/starter/test/alone.test.ts',
      'modules/starter/tsconfig.json',
      'modules/starter/tsconfig.test.json',
      'modules/starter/vitest.config.ts',
      'package.json',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'tsconfig.json',
      'vitest.config.ts',
    ]);
    expect(run.stdout).toContain(
      'next: cd my-platform && pnpm install && pnpm exec keelwerk generate && pnpm exec keelwerk dev',
    );
  });

  test('the deployment file is the only default export and the compose file runs start with it', async () => {
    const cwd = await emptyDirectory();
    await runCliWith(['init', 'shop', '--scope', '@acme'], createFakeHost({ cwd }).host);
    const deployment = await readFile(join(cwd, 'shop/.launchway/deployment.ts'), 'utf8');
    expect(deployment).toContain('export default deployment;');
    expect(deployment).toContain("import { shop } from '../apps/shop/src/app.ts';");
    const compose = await readFile(join(cwd, 'shop/.launchway/compose.yaml'), 'utf8');
    expect(compose).toContain('keelwerk start --config .launchway/deployment.ts');
    expect(compose).toContain('stop_grace_period: 70s');
    expect(compose).toContain('ledger:/var/lib/keelwerk/ledger');
    expect(compose).toContain('- /app/node_modules');
    expect(compose).toMatch(/^volumes:\n {2}ledger:/m);
    const launchway = await readFile(join(cwd, 'shop/.launchway/launchway.ts'), 'utf8');
    expect(launchway).not.toContain('export default');
  });

  test('names come from flags, and a bad one is a usage mistake that writes nothing', async () => {
    const cwd = await emptyDirectory();
    const named = await runCliWith(
      ['init', 'x', '--scope', '@acme', '--app', 'portal', '--module', 'notes'],
      createFakeHost({ cwd }).host,
    );
    expect(named.code).toBe(0);
    expect(await readFile(join(cwd, 'x/apps/portal/src/modules.ts'), 'utf8')).toContain(
      "from '@acme/module-notes'",
    );
    const bad = await runCliWith(['init', 'y', '--scope', 'acme'], createFakeHost({ cwd }).host);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--scope');
    const reserved = await runCliWith(
      ['init', 'z', '--scope', '@acme', '--module', 'core'],
      createFakeHost({ cwd }).host,
    );
    expect(reserved.code).toBe(2);
    expect(await readdir(cwd)).toEqual(['x']);
  });

  test('never overwrites a file and lists a dry run without writing', async () => {
    const cwd = await emptyDirectory();
    const dry = await runCliWith(
      ['init', 'shop', '--scope', '@acme', '--dry-run'],
      createFakeHost({ cwd }).host,
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('would create .launchway/deployment.ts');
    expect(await readdir(cwd)).toEqual([]);
    await runCliWith(['init', 'shop', '--scope', '@acme'], createFakeHost({ cwd }).host);
    await writeFile(join(cwd, 'shop/package.json'), '{ "mine": true }\n');
    const again = await runCliWith(
      ['init', 'shop', '--scope', '@acme'],
      createFakeHost({ cwd }).host,
    );
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already exists');
    expect(await readFile(join(cwd, 'shop/package.json'), 'utf8')).toBe('{ "mine": true }\n');
  });
});

describe('a project made by init', () => {
  test('type-checks with tsc -b and passes generate --check once generated', async () => {
    const made = await project();
    const checked = await runCliWith(
      ['generate', '--check'],
      createFakeHost({ cwd: made.root }).host,
    );
    expect(checked.code).toBe(1);
    const generated = await runCliWith(['generate'], createFakeHost({ cwd: made.root }).host);
    expect(generated.stderr).toBe('');
    expect(generated.code).toBe(0);
    const clean = await runCliWith(
      ['generate', '--check'],
      createFakeHost({ cwd: made.root }).host,
    );
    expect(clean.stderr).toBe('');
    expect(clean.code).toBe(0);
    for (const directory of [`apps/${made.app}`, `modules/${made.module}`]) {
      const file = join(made.root, directory, 'tsconfig.json');
      const parsed = JSON.parse(await readFile(file, 'utf8')) as { references?: unknown[] };
      await writeFile(
        file,
        `${JSON.stringify({
          ...parsed,
          references: [
            ...(parsed.references ?? []),
            ...['core', 'data'].map((name) => ({ path: join(repository, 'packages', name) })),
          ],
        })}\n`,
      );
    }
    const compiled = await execFileAsync(
      join(repository, 'node_modules', '.bin', 'tsc'),
      ['-b', join(made.root, 'tsconfig.json')],
      { cwd: made.root },
    ).catch((error: { stdout?: string }) => error);
    expect(compiled).not.toHaveProperty('code');
    const deploymentConfig = JSON.parse(
      await readFile(join(made.root, '.launchway', 'tsconfig.json'), 'utf8'),
    ) as { include: string[] };
    expect(deploymentConfig.include).toContain('deployment.ts');
    // The project has no installed tools, so only the checks on files and exports apply here.
    const unused = await execFileAsync(
      join(repository, 'node_modules', '.bin', 'knip'),
      ['--include', 'files,exports'],
      { cwd: made.root },
    ).catch((error: { stdout?: string; stderr?: string }) => error);
    expect(unused).not.toHaveProperty('code');
  }, 300_000);

  test('passes Biome with the framework preset, deployment file included', async () => {
    const made = await project();
    const generated = await runCliWith(['generate'], createFakeHost({ cwd: made.root }).host);
    expect(generated.code).toBe(0);
    const linted = await execFileAsync(
      join(repository, 'node_modules', '.bin', 'biome'),
      ['ci', '--colors=off', '.'],
      { cwd: made.root },
    ).catch((error: { stdout?: string; stderr?: string }) => error);
    expect(linted).not.toHaveProperty('code');
  }, 120_000);
});
