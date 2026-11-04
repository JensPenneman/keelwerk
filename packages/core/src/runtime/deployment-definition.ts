import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { SecretRef } from '../ids/secret-ref.ts';

/** One named process of the deployment (sections 4.6 and 21.1). */
export interface ProcessDefinition {
  /** What a process of this name does: serve invocations, work jobs, or both. */
  readonly roles: readonly ('serve' | 'work')[];
  /** Capabilities the process declares (section 21.2). */
  readonly capabilities?: readonly string[];
  /** Job slots per queue; `'*'` is every queue not named (section 21.1). */
  readonly slots?: Readonly<Record<string, number>>;
  /** The placements the process opens connections to. */
  readonly placements?: readonly string[];
  /** The node provider that starts and stops its replicas; `'static'` when the operator runs them. */
  readonly provider?: string;
  /** The replica limits the scaler clamps to (section 21.4). */
  readonly scale?: {
    readonly min?: number;
    readonly max?: number;
    readonly maxPerNode?: number;
  };
  /** Seconds a draining process may take to finish (section 21.6, default 60). */
  readonly drainSeconds?: number;
}

/** The scaler's deployment-wide limits (section 21.4). */
export interface DeploymentScaling {
  readonly maxProcesses?: number;
  readonly maxCostPerHour?: number;
  /** Maximum replicas per node provider, by provider name. */
  readonly providers?: Readonly<Record<string, { readonly max?: number }>>;
}

/**
 * The runtime view of a `defineDeployment` value: `defineDeployment` returns a subtype of it, so
 * the deployment file's default export is what `startRuntime` takes (section 3.3).
 */
export interface DeploymentDefinition {
  /** The catalogue a backend can be created from. */
  readonly apps: readonly { readonly id: string }[];
  /** Fills the deployment-level extension points (section 5.6). */
  readonly infrastructure: readonly unknown[];
  /** The control store (section 4.6); further members belong to the adapter. */
  readonly control: { readonly adapter: string; readonly [member: string]: unknown };
  /** Where tenant data may live, by placement name (section 4.6). */
  readonly placements: Readonly<
    Record<string, { readonly adapter: string; readonly [member: string]: unknown }>
  >;
  /** The operator socket and its bootstrap secret (section 4.6). */
  readonly operator?: {
    readonly socket?: string;
    readonly hosts?: readonly string[];
    readonly bootstrapSecret?: SecretRef;
  };
  /** The root of the key service (section 14.7.4). */
  readonly keys?: { readonly masterKey: SecretRef };
  /** Deployment order. */
  readonly tenantResolution?: readonly TenantResolver[];
  /** Listener port bindings (gap G1). */
  readonly ports?: Readonly<Record<string, number>>;
  /** Where OpenTelemetry data goes (section 11). */
  readonly telemetry?: { readonly otlp?: unknown };
  /** Finalization of rolling upgrades (section 19.4). */
  readonly rollout?: { readonly finalize?: 'auto' | 'manual'; readonly graceSeconds?: number };
  /** How often each scope's chain head goes to the ledger sinks: 'batch' or an ISO 8601 duration (section 15.1.8). */
  readonly anchors?: { readonly every: string };
  /** Named processes (section 21.1). */
  readonly processes?: Readonly<Record<string, ProcessDefinition>>;
  /** The scaler's deployment-wide limits (section 21.4). */
  readonly scaling?: DeploymentScaling;
  /** Job limits per queue (sections 9.5.5 and 21.4). */
  readonly queues?: Readonly<
    Record<string, { readonly running?: number; readonly queued?: number; readonly slo?: string }>
  >;
}
