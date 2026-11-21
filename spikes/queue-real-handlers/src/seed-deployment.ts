import { testCarrier, testPrincipal } from '@keelwerk/testing';
import type { ChildConfig } from './child-config.ts';
import type { Kind } from './kinds.ts';
import { tenantNames } from './kinds.ts';
import type { PostgresUrls } from './postgres-urls.ts';
import { startBenchRuntime } from './start-bench-runtime.ts';

/** The action each kind's jobs come from, and whether it is called asynchronously (the command job). */
const callOf: Readonly<Record<Kind, { readonly action: string; readonly async: boolean }>> = {
  command: { action: 'bench.record', async: true },
  reaction: { action: 'bench.record', async: false },
  effect: { action: 'bench.request', async: false },
};

/** What a child needs to join the deployment `seedDeployment` made. */
export type Deployment = Pick<ChildConfig, 'backendId' | 'tenants'>;

/** The deployment, and the PostgreSQL schema its tables are in. */
export interface SeededDeployment extends Deployment {
  readonly root: string;
}

/**
 * Creates the deployment on an empty database, eight tenants and no worker, and commits `perTenant`
 * jobs of `kind` for each of them (kind `calls`: none), so every worker starts with a full queue.
 * A reaction's jobs are made by the reaction dispatcher of this process, which settles before this answers. The runtime is stopped before this answers, so no connection of this process
 * stays open.
 */
export async function seedDeployment(
  urls: PostgresUrls,
  kind: Kind | 'calls',
  perTenant: number,
): Promise<SeededDeployment> {
  // The dispatcher makes the runtime run workers too; they work a queue that never holds a job, so
  // the jobs it makes wait for the processes of the measurement.
  const { runtime, dispatcher } = await startBenchRuntime(urls, {
    reactions: kind === 'reaction',
    ...(kind === 'reaction' ? { workers: { queues: ['parked'], slots: 1 } } : {}),
  });
  try {
    if (kind !== 'calls') {
      const { action, async } = callOf[kind];
      await Promise.all(
        tenantNames.map(async (name) => {
          const carrier = testCarrier(runtime.tenants[name], testPrincipal(null));
          for (let n = 0; n < perTenant; n += 1) {
            const outcome = await runtime.invoker.invoke({
              action,
              input: { label: `item ${n}` },
              carrier,
              requestId: crypto.randomUUID(),
              commandId: crypto.randomUUID(),
              ...(async ? { prefer: 'async' as const } : {}),
              signal: new AbortController().signal,
            });
            if (!outcome.ok) throw outcome.error;
          }
        }),
      );
      if (kind === 'reaction') while ((await dispatcher.settled()) > 0);
    }
    return {
      root: runtime.namespace.root,
      backendId: runtime.backendId,
      tenants: Object.fromEntries(tenantNames.map((name) => [name, runtime.tenants[name].id])),
    };
  } finally {
    await runtime.stop();
  }
}
