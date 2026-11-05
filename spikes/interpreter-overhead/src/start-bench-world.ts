import { postgresAdapter } from '@keelwerk/adapter-postgres';
import type { EntityDescriptor } from '@keelwerk/core';
import { startTestRuntime } from '@keelwerk/testing';
import { benchApp } from './bench-app.ts';
import type { BenchWorld } from './bench-world.ts';
import { moduleBehaviours } from './module-behaviours.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { runBenchCommand } from './run-bench-command.ts';

/** How many items are loaded: the most a decision loads. */
const seeded = 20;

/** How many items are written (one: every cell starts from the same fresh world, and its stream grows equally for every form). */
const writable = 1;

/** Starts the bench app on the in-memory adapter, or on the given PostgreSQL 18, and seeds its items. */
export async function startBenchWorld(postgres?: PostgresUrls): Promise<BenchWorld> {
  const runtime =
    postgres === undefined
      ? await startTestRuntime(benchApp, { tenants: ['acme'] })
      : await startTestRuntime(benchApp, {
          tenants: ['acme'],
          external: {
            factory: postgresAdapter({ ownerUrl: postgres.adminUrl }),
            url: postgres.appUrl,
          },
        });
  const tenant = runtime.tenants.acme;
  const entry = runtime.app.registry.entities.get('bench.item');
  if (entry === undefined) throw new Error('the bench app has no bench.item');
  const descriptor: EntityDescriptor = entry.descriptor;
  const world: BenchWorld = {
    label: postgres === undefined ? 'memory' : 'postgres',
    runtime,
    registry: runtime.app.registry,
    namespace: runtime.namespace,
    scope: { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id },
    behaviours: moduleBehaviours(benchApp),
    descriptor,
    ids: [],
    writeIds: [],
    stop: () => runtime.stop(),
  };
  const ids: string[] = [];
  for (let index = 0; index < seeded + writable; index += 1) {
    const result = await runBenchCommand(world, 'bench.seedItem', { label: `Item ${index}` });
    ids.push((result.output as { itemId: string }).itemId);
  }
  return { ...world, ids: ids.slice(0, seeded), writeIds: ids.slice(seeded) };
}
