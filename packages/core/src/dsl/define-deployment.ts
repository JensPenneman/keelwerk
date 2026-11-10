import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { SecretRef } from '../ids/secret-ref.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { Check } from '../model/check.ts';
import type { ContractsIn } from '../model/contracts-in.ts';
import type {
  DeploymentDefinition,
  DeploymentScaling,
  ProcessDefinition,
} from '../runtime/deployment-definition.ts';
import { runtimeInfrastructure } from '../runtime/runtime-infrastructure.ts';
import { compositionRefusal } from './composition-refusal.ts';
import type { AnyContract } from './define-contract.ts';
import type { EnvRef } from './env.ts';

type DeployedModules<Apps> = Apps extends readonly (infer P)[]
  ? P extends { readonly modules: readonly (infer M)[] }
    ? M
    : never
  : never;
type RequiredDeploymentContracts<Apps> =
  DeployedModules<Apps> extends infer M
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

/** The named check of `defineDeployment`: `missingInfrastructure` names the contracts no entry provides. */
export type DeploymentChecks<
  Apps extends readonly DeployableApp[],
  Infra extends readonly object[],
> = Check<
  Exclude<RequiredDeploymentContracts<Apps>, ProvidedByInfrastructure<Infra>>,
  'missingInfrastructure'
>;

/** An app a deployment can run: its id and its selection. */
export interface DeployableApp {
  readonly id: string;
  readonly modules: readonly AnyModule[];
}

/** An infrastructure entry: a data adapter, the HTTP host, a blob store, a ledger sink (section 4.6). */
export interface InfrastructureEntry {
  readonly kind: string;
  readonly provides: readonly AnyContract[];
}

/** A placement: where tenant data may live (sections 4.6 and 14.4). */
export type Placement = {
  readonly adapter: string;
  readonly url: EnvRef | string;
  readonly strategy: 'shared-tables' | 'schema-per-tenant' | 'database-per-tenant';
  readonly maxConnections?: number;
};

/** The control store (section 4.6). */
export type ControlStore = { readonly adapter: string; readonly url: EnvRef | string };

/** The options of `defineDeployment` (section 4.6). */
export interface DeploymentOptions<
  Apps extends readonly DeployableApp[],
  Infra extends readonly object[],
> {
  readonly apps: Apps;
  readonly infrastructure: Infra;
  readonly control: ControlStore;
  readonly placements: { readonly [name: string]: Placement };
  readonly tenantResolution: readonly TenantResolver[];
  readonly ports?: { readonly [listener: string]: number };
  readonly operator?: {
    readonly socket?: string;
    readonly hosts?: readonly string[];
    readonly bootstrapSecret?: SecretRef;
  };
  readonly keys?: { readonly masterKey: SecretRef };
  readonly telemetry?: { readonly otlp?: EnvRef };
  readonly rollout?: { readonly finalize?: 'auto' | 'manual'; readonly graceSeconds?: number };
  readonly anchors?: { readonly every: string };
  readonly processes?: { readonly [name: string]: ProcessDefinition };
  readonly scaling?: DeploymentScaling;
  readonly queues?: {
    readonly [queue: string]: {
      readonly running?: number;
      readonly queued?: number;
      readonly slo?: string;
      /** The lanes one take may lock; defaults to the take's batch size (section 9.5.6). */
      readonly takeLanes?: number;
    };
  };
}

/** A deployment value: a subtype of what `startRuntime` takes (S-49). */
export interface Deployment<
  Apps extends readonly DeployableApp[] = readonly DeployableApp[],
  Infra extends readonly object[] = readonly object[],
> extends DeploymentDefinition {
  readonly kind: 'deployment';
  readonly apps: Apps;
  readonly infrastructure: Infra;
  readonly control: ControlStore;
  readonly placements: { readonly [name: string]: Placement };
  readonly tenantResolution: readonly TenantResolver[];
}

/**
 * Describes where the apps run (section 4.6). Fails with `missingInfrastructure` when a
 * deployment-level contract has no provider, at the type level and again at runtime. The value
 * is the default export of the deployment file. Entries without `provides` (adapter factories,
 * ledger sinks, the schema planner) are accepted and provide nothing (open point 458, S-108).
 */
export function defineDeployment<
  const Apps extends readonly DeployableApp[],
  const Infra extends readonly object[],
>(config: DeploymentOptions<Apps, Infra> & DeploymentChecks<Apps, Infra>): Deployment<Apps, Infra> {
  const provided = runtimeInfrastructure(config.infrastructure).provided;
  for (const app of config.apps) {
    for (const module of app.modules) {
      for (const dependency of module.requires ?? []) {
        if (
          dependency.kind === 'contract' &&
          dependency.level === 'deployment' &&
          !provided.has(dependency.contract)
        ) {
          throw compositionRefusal({
            code: 'missingInfrastructure',
            severity: 'error',
            message: `No infrastructure entry provides the contract '${dependency.contract}', which '${module.id}' of app '${app.id}' requires.`,
            module: module.id,
            ref: dependency.contract,
          });
        }
      }
    }
  }
  return { ...config, kind: 'deployment' };
}
