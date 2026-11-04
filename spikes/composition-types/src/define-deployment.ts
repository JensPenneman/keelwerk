import type { AnyModule } from './any-module.ts';
import type { ContractsIn } from './base-members.ts';
import type { Check } from './check.ts';
import type { AnyContract } from './define-contract.ts';
import type { EnvRef } from './env.ts';
import type { SecretSource } from './secret.ts';
import type { TenantResolver } from './tenant-resolver.ts';

type ModulesOf<Apps> = Apps extends readonly (infer P)[]
  ? P extends { readonly modules: readonly (infer M)[] }
    ? M
    : never
  : never;
type RequiredDeploymentContracts<Apps> =
  ModulesOf<Apps> extends infer M
    ? M extends { readonly requires: infer L }
      ? ContractsIn<L, 'deployment'>
      : never
    : never;
type ProvidedByInfrastructure<Infra> = Infra extends readonly (infer P)[]
  ? P extends { readonly provides: readonly (infer C)[] }
    ? C extends { readonly contract: infer N extends string }
      ? N
      : never
    : never
  : never;

/** An infrastructure entry: a data adapter, the HTTP host, a blob store, a ledger sink (section 4.6). */
export interface InfrastructureEntry {
  readonly kind: string;
  readonly provides: readonly AnyContract[];
}

/** A placement: where tenant data may live. */
export interface Placement {
  readonly adapter: string;
  readonly url: EnvRef | string;
  readonly strategy: 'shared-tables' | 'schema-per-tenant' | 'database-per-tenant';
  readonly maxConnections?: number;
}

/** The options of `defineDeployment` the spike types. */
export interface DeploymentOptions<Apps, Infra> {
  readonly apps: Apps;
  readonly infrastructure: Infra;
  readonly control: { readonly adapter: string; readonly url: EnvRef | string };
  readonly placements: { readonly [name: string]: Placement };
  readonly tenantResolution: readonly TenantResolver[];
  readonly ports?: { readonly [listener: string]: number };
  readonly operator?: {
    readonly socket?: string;
    readonly hosts?: readonly string[];
    readonly bootstrapSecret?: SecretSource;
  };
  readonly keys?: { readonly masterKey: SecretSource };
  readonly telemetry?: { readonly otlp?: EnvRef };
  readonly rollout?: { readonly finalize?: 'auto' | 'manual'; readonly graceSeconds?: number };
  readonly anchors?: { readonly every: string };
  readonly processes?: { readonly [name: string]: object };
  readonly scaling?: { readonly maxProcesses?: number };
  readonly queues?: { readonly [queue: string]: object };
}

/** A deployment value. */
export interface Deployment<Apps> {
  readonly kind: 'deployment';
  readonly apps: Apps;
}

/** Describes where the apps run; fails with `missingInfrastructure` when a deployment-level contract has no provider. */
export function defineDeployment<
  const Apps extends readonly { readonly modules: readonly AnyModule[] }[],
  const Infra extends readonly InfrastructureEntry[],
>(
  config: DeploymentOptions<Apps, Infra> &
    Check<
      Exclude<RequiredDeploymentContracts<Apps>, ProvidedByInfrastructure<Infra>>,
      'missingInfrastructure'
    >,
): Deployment<Apps> {
  return { kind: 'deployment', apps: config.apps };
}
