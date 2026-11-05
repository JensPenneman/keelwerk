import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DeploymentDefinition } from '@keelwerk/core';
import { startRuntime } from '@keelwerk/core';
import { expect, test } from 'vitest';
import type { OpenedDeployment } from '../src/db/opened-deployment.ts';
import { scopeTargetsOf } from '../src/db/scope-targets-of.ts';
import { useScratchProject } from './support/scratch-project.ts';

const newProject = useScratchProject();
const factory = fileURLToPath(new URL('./support/durable-pglite-factory.ts', import.meta.url));
const key = Buffer.alloc(32, 7).toString('base64');

function configText(directories: { control: string; main: string; ledger: string }): string {
  return `import { defineApp, secret } from '@keelwerk/core';
import { ledgerFile } from '@keelwerk/core/ledger';
import { schemaPlanner } from '@keelwerk/data';
import { durablePgliteFactory } from ${JSON.stringify(factory)};

export default {
  apps: [defineApp({ id: 'demo', modules: [] })],
  infrastructure: [
    durablePgliteFactory(),
    schemaPlanner(),
    ledgerFile({ path: ${JSON.stringify(directories.ledger)} }),
  ],
  control: { adapter: 'pglite', url: ${JSON.stringify(directories.control)} },
  placements: { main: { adapter: 'pglite', strategy: 'shared-tables', url: ${JSON.stringify(directories.main)} } },
  tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
  keys: { masterKey: secret('KW_VERIFY_KEY') },
};
`;
}

async function runOnce(config: DeploymentDefinition, name: string): Promise<void> {
  const runtime = await startRuntime(config, {
    role: 'all',
    listen: false,
    environment: 'test',
    env: Object.fromEntries([['KW_VERIFY_KEY', key]]),
  });
  await runtime.control.createBackend({ name, app: 'demo', placement: 'main' });
  await runtime.stop(1000);
}

test('a deployment verifies against its anchors, and a control store rewound behind them is found', async () => {
  const project = await newProject();
  const directories = {
    control: join(project.root, 'data/control'),
    main: join(project.root, 'data/main'),
    ledger: join(project.root, 'ledger/anchors.log'),
  };
  await mkdir(join(project.root, 'ledger'), { recursive: true });
  await mkdir(join(project.root, 'data'), { recursive: true });
  const configPath = join(project.root, 'keelwerk.config.ts');
  await writeFile(configPath, configText(directories));
  const loaded: { default: DeploymentDefinition } = await import(pathToFileURL(configPath).href);

  await runOnce(loaded.default, 'first');
  const backup = join(project.root, 'backup-control');
  await cp(directories.control, backup, { recursive: true });
  await runOnce(loaded.default, 'second');

  const sound = await project.run('db', 'verify', '--config', configPath, '--output', 'text');
  expect(sound.stderr).toBe('');
  expect(sound.stdout).toMatch(/^[1-9]\d* anchors verified/);
  expect(sound.code).toBe(0);
  const soundJson = await project.run('db', 'verify', '--config', configPath);
  expect(soundJson.code).toBe(0);
  const verdict = JSON.parse(soundJson.stdout);
  expect(verdict.unresolved).toEqual([]);
  expect(verdict.findings).toEqual([]);
  expect(verdict.checked).toBeGreaterThan(0);

  await rm(directories.control, { recursive: true, force: true });
  await cp(backup, directories.control, { recursive: true });
  const rewound = await project.run('db', 'verify', '--config', configPath, '--output', 'text');
  expect(rewound.code).toBe(1);
  expect(rewound.stderr).toMatch(/behind [0-9a-f-]{36}/);

  const asJson = await project.run('db', 'verify', '--config', configPath);
  expect(asJson.code).toBe(1);
  expect(JSON.parse(asJson.stdout).findings[0]).toMatchObject({ kind: expect.any(String) });
}, 240_000);

test('db verify, apply and status refuse a missing deployment file and a profile connection', async () => {
  const project = await newProject();
  for (const command of ['verify', 'apply', 'status']) {
    const none = await project.run('db', command);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain(`db ${command} runs against the project's deployment file`);
  }
});

test('backend and tenant scopes resolve to the namespace of their app on their placement, and an unknown scope is left out', async () => {
  const backend = { id: 'bknd_a', placement: 'main', app: 'demo-shop' };
  const tenant = { id: 'tnt_a', backendId: 'bknd_a' };
  const find = (entity: { readonly ref: string }, query: { readonly where?: unknown }) => {
    const where = JSON.stringify(query.where);
    const rows = entity.ref === 'core.backend' ? [backend] : [tenant];
    return Promise.resolve(rows.find((row) => where.includes(`"${row.id}"`)));
  };
  const adapter = { placement: 'main' };
  const opened = {
    deploymentId: 'dep',
    apps: [
      {
        registry: {
          entities: new Map(
            ['core.backend', 'core.tenant'].map((ref) => [ref, { descriptor: { ref } }]),
          ),
        },
      },
    ],
    control: {
      namespace: { root: 'kw__control' },
      adapter: {
        unit: async (_n: unknown, _s: unknown, work: (unit: unknown) => unknown) =>
          work({ rows: { findOne: find } }),
      },
    },
    placements: [{ name: 'main', adapter }],
  } as unknown as OpenedDeployment;
  const targets = await scopeTargetsOf(opened)(new Set(['dep', 'bknd_a', 'tnt_a', 'bknd_unknown']));
  expect([...targets.keys()].toSorted()).toEqual(['bknd_a', 'dep', 'tnt_a']);
  expect(targets.get('dep')?.scope).toEqual({ level: 'deployment' });
  expect(targets.get('bknd_a')?.scope).toEqual({ level: 'backend', backendId: 'bknd_a' });
  expect(targets.get('bknd_a')?.namespace.root).toBe('demo_shop');
  expect(targets.get('tnt_a')?.scope).toEqual({
    level: 'tenant',
    backendId: 'bknd_a',
    tenantId: 'tnt_a',
  });
  expect(targets.get('tnt_a')?.handle.adapter).toBe(adapter);
});
