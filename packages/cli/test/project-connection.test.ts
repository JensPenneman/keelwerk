import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeploymentDefinition, RuntimeOptions } from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import { expect, test, vi } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';
import { demoApp, useScratchProject } from './support/scratch-project.ts';

const probes: unknown[] = [];

/** The real runtime, asked for its probe: a process that works hands one over once its workers run. */
vi.mock('@keelwerk/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@keelwerk/core')>();
  return {
    ...actual,
    startRuntime: vi.fn((definition: DeploymentDefinition, options: RuntimeOptions) =>
      actual.startRuntime(definition, {
        ...options,
        work: { probe: (probe) => probes.push(probe) },
      }),
    ),
  };
});

const newProject = useScratchProject();
const key = Buffer.alloc(32, 7).toString('base64');
const factory = fileURLToPath(new URL('./support/durable-pglite-factory.ts', import.meta.url));

const configText = (root: string): string => `import { secret } from '@keelwerk/core';
import { schemaPlanner } from '@keelwerk/data';
import { demo } from './apps/demo/src/app.ts';
import { durablePgliteFactory } from ${JSON.stringify(factory)};

export default {
  apps: [demo],
  keys: { masterKey: secret('KW_PROJECT_KEY') },
  infrastructure: [durablePgliteFactory(), schemaPlanner()],
  control: { adapter: 'pglite', url: ${JSON.stringify(join(root, 'data/control'))} },
  placements: { main: { adapter: 'pglite', strategy: 'shared-tables', url: ${JSON.stringify(join(root, 'data/main'))} } },
};
`;

test('a command of the CLI in a project runs a serving process: it starts no worker and takes no job', async () => {
  const project = await newProject();
  await project.write({ 'apps/demo/src/app.ts': demoApp });
  await mkdir(join(project.root, 'data'), { recursive: true });
  await writeFile(join(project.root, 'keelwerk.config.ts'), configText(project.root));
  const run = (...argv: string[]) =>
    runCliWith(
      [...argv, '--config', join(project.root, 'keelwerk.config.ts'), '--output', 'json'],
      createFakeHost({
        cwd: project.root,
        env: Object.fromEntries([['KW_PROJECT_KEY', key]]),
        files: { [`${project.root}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n' },
      }).host,
    );
  expect((await run('db', 'apply')).code).toBe(0);
  expect((await run('backend', 'list')).code).toBe(0);
  const options = vi.mocked(startRuntime).mock.calls.map(([, runtimeOptions]) => runtimeOptions);
  expect(options.length).toBeGreaterThan(0);
  expect(options.map((entry) => entry.role)).not.toContain('all');
  expect(options.map((entry) => entry.role)).not.toContain('work');
  expect(probes).toEqual([]);
}, 120_000);
