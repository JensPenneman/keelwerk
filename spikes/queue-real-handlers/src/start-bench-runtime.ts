import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { consumers, reactionDispatcher } from '@keelwerk/events';
import { startTestRuntime } from '@keelwerk/testing';
import { plainApp, reactionApp } from './bench-app.ts';
import type { ChildConfig } from './child-config.ts';
import { tenantNames } from './kinds.ts';
import type { PostgresUrls } from './postgres-urls.ts';

/**
 * Starts a runtime of the measurement on the PostgreSQL database `urls`: the reaction app with the
 * reaction dispatcher in this process when `reactions`, else the plain app. `join` attaches it to a
 * deployment another process made; `workers` gives it kernel workers.
 */
export async function startBenchRuntime(
  urls: PostgresUrls,
  options: {
    readonly reactions: boolean;
    readonly join?: Pick<ChildConfig, 'backendId' | 'tenants'>;
    readonly workers?: { readonly queues: readonly string[]; readonly slots: number };
  },
) {
  const dispatcher = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
  const common = {
    tenants: tenantNames,
    external: { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl },
    ...(options.join === undefined ? {} : { join: options.join }),
    ...(options.workers === undefined ? {} : { workers: options.workers }),
  };
  const runtime = options.reactions
    ? await startTestRuntime(reactionApp, { ...common, eventWorkers: [dispatcher] })
    : await startTestRuntime(plainApp, common);
  return { runtime, dispatcher };
}
