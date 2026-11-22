import { reenqueueUnsettledEffects } from '../control/reenqueue-unsettled-effects.ts';
import { errors } from '../errors/errors.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import { rebuildFromChain } from '../replay/rebuild-from-chain.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { anchorScopes } from './anchor-scopes.ts';
import type { Connected } from './connected.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RebuildReport } from './rebuild-report.ts';
import type { ServedApp } from './served-app.ts';

/**
 * `RuntimeControl.rebuild`: the chain entities of a backend or a tenant folded from their streams
 * (`rebuildFromChain` on the placement's sealing adapter), then every effect left requested
 * enqueued again (`reenqueueUnsettledEffects`, 14.7.6). The deployment id is `unsupported`, an id
 * that resolves to no scope `not_found`, and a scope whose app this process does not serve
 * `unavailable`. One info log: the scope, the entities and the jobs enqueued.
 */
export async function rebuildScope(input: {
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly served: readonly ServedApp[];
  /** The process's quota cache, asked before each re-enqueue. */
  readonly quotas: QuotaLimits | undefined;
  readonly scopeId: string;
}): Promise<RebuildReport> {
  const { connected, migrated, served, scopeId } = input;
  if (scopeId === connected.deploymentId) {
    throw errors.unsupported(
      'The control store is not rebuilt in this release; rebuild a backend or a tenant.',
    );
  }
  const target = (await anchorScopes(connected, migrated, new Set([scopeId]))).get(scopeId);
  if (target === undefined) throw errors.not_found(`The scope ${scopeId} does not resolve.`);
  const app = served.find((candidate) => candidate.id === target.namespace.appId);
  if (app === undefined) {
    throw errors.unavailable(`The app "${target.namespace.appId}" is not served by this process.`);
  }
  const entities = await rebuildFromChain({
    adapter: target.handle.adapter,
    namespace: target.namespace,
    scope: target.scope,
    registry: app.registry,
    behaviours: registryBehaviours(app.registry),
  });
  const enqueued = await reenqueueUnsettledEffects({
    connected,
    target,
    registry: app.registry,
    clock: connected.control.clock,
    directory: migrated.directory.lookup,
    apps: new Map(served.map((candidate) => [candidate.id, candidate] as const)),
    quotas: input.quotas,
  });
  connected.log.info('a scope was rebuilt from its chain', { scope: scopeId, entities, enqueued });
  return { scopeId, entities, enqueued };
}
