import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTypeId } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { runCliWith } from './support/run-cli-with.ts';
import { demoApp, useScratchProject } from './support/scratch-project.ts';

const CONFLICT = 7;
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

test('in a project the CLI creates a backend and a tenant through the control path and lists them in the next process', async () => {
  const project = await newProject();
  await project.write({ 'apps/demo/src/app.ts': demoApp });
  await mkdir(join(project.root, 'data'), { recursive: true });
  await writeFile(join(project.root, 'keelwerk.config.ts'), configText(project.root));
  // Command ids are unique across processes, as real ones are: a create that repeats another's input is no replay.
  const run = (...argv: string[]) => {
    const fake = createFakeHost({
      cwd: project.root,
      env: Object.fromEntries([['KW_PROJECT_KEY', key]]),
      files: { [`${project.root}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n' },
    });
    return runCliWith(
      [...argv, '--config', join(project.root, 'keelwerk.config.ts'), '--output', 'json'],
      {
        ...fake.host,
        newId: () => crypto.randomUUID(),
      },
    );
  };

  expect((await run('db', 'apply')).code).toBe(0);
  const backend = await run('backend', 'create', 'main', '--app', 'demo', '--placement', 'main');
  expect(backend.stderr).toBe('');
  expect(backend.code).toBe(0);
  expect(JSON.parse(backend.stdout)).toMatchObject({ id: expect.stringMatching(/^bknd_/) });

  const tenant = await run(
    'tenant',
    'create',
    'acme',
    '--backend',
    'main',
    '--domain',
    'acme.example.test',
    '--domain',
    'www.acme.example.test',
  );
  expect(tenant.stderr).toBe('');
  expect(tenant.code).toBe(0);
  expect(JSON.parse(tenant.stdout)).toMatchObject({ id: expect.stringMatching(/^tnt_/) });

  const backends = await run('backend', 'list');
  expect(JSON.parse(backends.stdout)).toMatchObject([{ name: 'main', app: 'demo' }]);
  const tenants = await run('tenant', 'list', '--backend', 'main');
  expect(JSON.parse(tenants.stdout)).toMatchObject([
    { name: 'acme', domains: 'acme.example.test,www.acme.example.test' },
  ]);

  const clash = await run('backend', 'create', 'main', '--app', 'demo', '--placement', 'main');
  expect(clash.code).toBe(CONFLICT);
  expect(JSON.parse(clash.stderr)).toMatchObject({ kind: 'conflict', code: 'core.conflict' });

  const other = await run(
    'tenant',
    'create',
    'globex',
    '--backend',
    'main',
    '--domain',
    'acme.example.test',
  );
  expect(other.code).toBe(CONFLICT);
  expect(JSON.parse(other.stderr)).toMatchObject({ kind: 'conflict', code: 'core.conflict' });
  expect(JSON.parse((await run('tenant', 'list', '--backend', 'main')).stdout)).toHaveLength(1);

  // A backend named by its public id is found by that id (the filter carries the TypeID): the
  // command gets as far as the tenant, which is not entered; an id no backend has is a usage error.
  const backendId = (JSON.parse(backend.stdout) as { id: string }).id;
  const tenantId = (JSON.parse(tenant.stdout) as { id: string }).id;
  const callIn = (id: string) =>
    run('call', 'core.tenant.query', '--backend', id, '--tenant', tenantId, '--input', '{}');
  const found = await callIn(backendId);
  expect(found.code).toBe(5);
  expect(JSON.parse(found.stderr)).toMatchObject({ code: 'core.tenant_not_entered' });
  const missing = await callIn(renderTypeId('bknd', crypto.randomUUID()));
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain('No backend is named');

  // A dev socket left behind by a `keelwerk dev` that died does not stop the in-process runtime.
  const stale = await runCliWith(
    ['backend', 'list', '--config', join(project.root, 'keelwerk.config.ts'), '--output', 'json'],
    createFakeHost({
      cwd: project.root,
      env: Object.fromEntries([['KW_PROJECT_KEY', key]]),
      files: {
        [`${project.root}/pnpm-workspace.yaml`]: 'packages:\n  - packages/*\n',
        [`${project.root}/.keelwerk/dev.sock`]: '',
      },
    }).host,
  );
  expect(stale.stderr).toBe('');
  expect(stale.code).toBe(0);
  expect(JSON.parse(stale.stdout)).toMatchObject([{ name: 'main' }]);

  const modules = await run('introspect', 'modules');
  expect(JSON.parse(modules.stdout)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'core' })]),
  );
}, 240_000);
