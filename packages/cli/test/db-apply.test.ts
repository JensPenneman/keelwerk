import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DeploymentDefinition } from '@keelwerk/core';
import { controlNamespace, recordedDeploymentId, startRuntime } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { liveBuildIds } from '../src/db/live-build-ids.ts';
import { openDeployment } from '../src/db/open-deployment.ts';
import type { OpenedDeployment } from '../src/db/opened-deployment.ts';
import { useScratchProject } from './support/scratch-project.ts';
import { shopSources } from './support/shop-project.ts';

const newProject = useScratchProject();
const key = Buffer.alloc(32, 7).toString('base64');
const env = Object.fromEntries([['KW_APPLY_KEY', key]]);
const factory = fileURLToPath(new URL('./support/durable-pglite-factory.ts', import.meta.url));

const configText = (root: string): string => `import { secret } from '@keelwerk/core';
import { schemaPlanner } from '@keelwerk/data';
import { demo } from './apps/demo/src/app.ts';
import { durablePgliteFactory } from ${JSON.stringify(factory)};

export default {
  apps: [demo],
  keys: { masterKey: secret('KW_APPLY_KEY') },
  infrastructure: [durablePgliteFactory(), schemaPlanner()],
  control: { adapter: 'pglite', url: ${JSON.stringify(join(root, 'data/control'))} },
  placements: { main: { adapter: 'pglite', strategy: 'shared-tables', url: ${JSON.stringify(join(root, 'data/main'))} } },
};
`;

async function renamedProject() {
  const first = await newProject();
  await first.write(shopSources('total'));
  await first.run('generate');
  await first.run('db', 'generate', 'shop', '--name', 'initial');
  const second = await first.fork();
  await second.write(shopSources('amount'));
  await second.run('generate');
  const renamed = await second.run(
    'db',
    'generate',
    'shop',
    '--name',
    'rename-total',
    '--rename',
    'shop.order.total=amount',
  );
  expect(renamed.code).toBe(0);
  const project = await second.fork();
  await mkdir(join(project.root, 'data'), { recursive: true });
  const configPath = join(project.root, 'keelwerk.config.ts');
  await writeFile(configPath, configText(project.root));
  const db = (...argv: string[]) =>
    project.run('db', ...argv, '--config', configPath, '--output', 'text');
  return { project, configPath, db };
}

test('db status lists pending files, db apply applies expand files and defers contract files until --contract', async () => {
  const { project, configPath, db } = await renamedProject();

  const before = await db('status');
  expect(before.code).toBe(0);
  expect(before.stdout).toContain('main/demo');
  expect(before.stdout).toContain('pending  shop 0001-initial');
  expect(before.stdout).toContain('pending  shop 0003-rename-total-contract');

  const applied = await db('apply');
  expect(applied.stderr).toBe('');
  expect(applied.stdout).toContain('main/demo: applied shop 0001-initial');
  expect(applied.stdout).toContain('main/demo: applied shop 0002-rename-total');
  expect(applied.stdout).toContain('deferred shop 0003-rename-total-contract');

  const contract = await db('apply', '--contract');
  expect(contract.stdout).toContain('main/demo: applied shop 0003-rename-total-contract');

  const after = await db('status');
  expect(after.stdout).toContain('applied  shop 0003-rename-total-contract');
  expect(after.stdout).not.toContain('pending');
  expect((await db('apply')).stdout).toContain('nothing to apply');
  expect(
    (await project.run('migrate', '--config', configPath, '--output', 'text')).stdout,
  ).toContain('nothing to apply');
}, 240_000);

test('--contract waits for no live process on another build, and the build id equals the one connect computes', async () => {
  const { configPath, db } = await renamedProject();
  expect((await db('apply')).code).toBe(0);

  const loaded: { default: DeploymentDefinition } = await import(pathToFileURL(configPath).href);
  const runtime = await startRuntime(loaded.default, {
    role: 'all',
    listen: false,
    environment: 'test',
    env,
  });
  await runtime.stop(1000);

  const restarted = await startRuntime(loaded.default, {
    role: 'all',
    listen: false,
    environment: 'test',
    env,
  });
  await restarted.stop(1000);
  const firstOpen = await openDeployment(configPath, env);
  try {
    const recorded = await recordedDeploymentId(
      firstOpen.control.adapter,
      controlNamespace('control'),
    );
    expect(firstOpen.deploymentId).toBe(recorded);
    expect(firstOpen.control.namespace).toEqual(controlNamespace('control'));
    expect(firstOpen.deploymentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  } finally {
    await firstOpen.close();
  }

  const setProcess = async (buildId: string | undefined): Promise<string> => {
    const opened = await openDeployment(configPath, env);
    try {
      const entity = opened.apps[0]?.registry.entities.get('core.process')?.descriptor;
      if (entity === undefined) throw new Error('core.process is not registered');
      const live = Temporal.Instant.fromEpochMilliseconds(Date.parse('2026-11-05T09:29:50Z'));
      return await opened.control.adapter.unit(
        opened.control.namespace,
        { level: 'deployment' },
        async (unit) => {
          const row = (await unit.rows.find(entity, {})).rows[0];
          if (row === undefined) throw new Error('the runtime left no process row');
          const next = {
            ...row,
            state: 'ready',
            heartbeatAt: live,
            buildId: buildId ?? row.buildId,
          };
          await unit.rows.update(entity, [
            {
              id: String(row.id),
              expectedVersion: Number(row.version),
              values: { ...next, version: Number(row.version) + 1 },
            },
          ]);
          return String(row.buildId);
        },
      );
    } finally {
      await opened.close();
    }
  };

  const runtimeBuild = await setProcess('a-build-that-is-not-this-one');
  const refused = await db('apply', '--contract');
  expect(refused.code).not.toBe(0);
  expect(refused.stderr).toContain('core.rollout_not_finalized');
  expect((await db('status')).stdout).toContain('pending  shop 0003-rename-total-contract');

  await setProcess(runtimeBuild);
  const allowed = await db('apply', '--contract');
  expect(allowed.stderr).toBe('');
  expect(allowed.stdout).toContain('main/demo: applied shop 0003-rename-total-contract');
}, 240_000);

test('live processes are the rows that are neither stopped nor silent for 30 seconds', async () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  const beat = (secondsAgo: number) =>
    Temporal.Instant.fromEpochMilliseconds(now - secondsAgo * 1000);
  const rows = [
    { state: 'ready', heartbeatAt: beat(5), buildId: 'other-build' },
    { state: 'draining', heartbeatAt: beat(29), buildId: 'draining-build' },
    { state: 'stopped', heartbeatAt: beat(1), buildId: 'stopped-build' },
    { state: 'ready', heartbeatAt: beat(300), buildId: 'gone-build' },
  ];
  const entity = { ref: 'core.process' };
  const opened = {
    deploymentId: 'dep',
    control: {
      namespace: { root: 'kw__control' },
      adapter: {
        unit: async (_namespace: unknown, _scope: unknown, work: (unit: unknown) => unknown) =>
          work({ rows: { find: async () => ({ rows }) } }),
      },
    },
  } as unknown as OpenedDeployment;
  const app = {
    registry: { entities: new Map([['core.process', { descriptor: entity }]]) },
  } as never;
  expect(await liveBuildIds(opened, app, now)).toEqual(['other-build', 'draining-build']);
  expect(await liveBuildIds({ ...opened, deploymentId: undefined }, app, now)).toEqual([]);
});
