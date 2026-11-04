import type { TenantResolver } from '../edge/tenant-resolver.ts';
import type { SecretRef } from '../ids/secret-ref.ts';

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
}
