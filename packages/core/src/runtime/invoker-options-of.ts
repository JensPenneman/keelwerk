import type { RowEnvironment } from '../authorization/row-environment.ts';
import { latestTenantEntry } from '../control/latest-tenant-entry.ts';
import type { RestoreHold } from '../control/restore-hold.ts';
import type { ExplainDecisions } from '../explain/explain-decisions.ts';
import type { FlagProvider } from '../flags/flag-provider.ts';
import type { TargetingCache } from '../flags/targeting-cache.ts';
import type { InvokerOptions } from '../invoker/invoker-options.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import { createOperatorTokenResolver } from '../principals/operator-token-resolver.ts';
import type { ConcurrencyLeases } from '../quotas/concurrency-leases.ts';
import type { QuotaLimits } from '../quotas/quota-limits.ts';
import type { Connected } from './connected.ts';
import { controlCommandsOf } from './control-commands-of.ts';
import type { ControlPath } from './control-path.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { Migrated } from './migrate-phase.ts';
import type { ServedApp } from './served-app.ts';

/**
 * The options of the runtime's invoker: the connected control app, the placements, the directory,
 * the control commands routed to the control path, and the caches the invoker reads (targeting,
 * quotas). Each work package that gives the invoker a member adds it here.
 */
export function invokerOptionsOf(input: {
  readonly deployment: DeploymentDefinition;
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly served: readonly ServedApp[];
  readonly apps: InvokerOptions['apps'];
  readonly controlPath: ControlPath;
  readonly restoreHold: RestoreHold;
  readonly decisions: ExplainDecisions | undefined;
  readonly flagProviders: readonly FlagProvider[];
  readonly targeting: TargetingCache;
  /** The process's quota cache, built and loaded at the start (`startRuntime`). */
  readonly quotas: QuotaLimits;
  /** The process's slots of the deployment-wide counts (`startRuntime`). */
  readonly leases: ConcurrencyLeases;
  readonly environment: RowEnvironment;
  readonly clock: Clock;
  readonly log: Logger;
}): InvokerOptions & { readonly quotas: QuotaLimits } {
  const { deployment, connected, migrated, served, decisions, clock, log } = input;
  return {
    apps: input.apps,
    directory: migrated.directory.lookup,
    placement: (name) => connected.placements.get(name),
    control: {
      scope: { level: 'deployment' },
      namespace: connected.control.namespace,
      handle: {
        adapter: connected.control.adapter,
        capabilities: connected.control.capabilities,
      },
    },
    ...(deployment.tenantResolution === undefined
      ? {}
      : { tenantResolution: deployment.tenantResolution }),
    clock,
    epochOf: (scope) => connected.control.epochOf(scope),
    restoreHold: input.restoreHold,
    operatorTokens: createOperatorTokenResolver(connected.control),
    tenantEntry: (tenantId, actor) => latestTenantEntry(connected.control, tenantId, actor),
    operatorHosts: deployment.operator?.hosts ?? [],
    ...(decisions === undefined ? {} : { onDecision: decisions.onDecision }),
    keys: connected.keys,
    compute: connected.compute,
    log,
    apiUsage: connected.control.apiUsage,
    quotas: input.quotas,
    leases: input.leases,
    environment: input.environment,
    flagProviders: input.flagProviders,
    targeting: input.targeting,
    build: connected.build,
    commands: controlCommandsOf({ connected, controlPath: input.controlPath, served, clock }),
  };
}
