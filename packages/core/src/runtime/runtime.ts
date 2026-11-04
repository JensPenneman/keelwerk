import type { Invoker } from '../invoker/invoker.ts';
import type { Registry } from '../registry/registry.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { DeploymentDefinition } from './deployment-definition.ts';
import type { RuntimeOptions } from './runtime-options.ts';

/** A booted process (section 3.3). */
export interface Runtime {
  readonly invoker: Invoker;
  /** Default: the app's head. */
  surface(appId: string, version?: string): ApiSurface;
  /** The composed registry of an app (section 3.3). */
  registry(appId: string): Registry;
  /** With `listen` and an HTTP host in the infrastructure. */
  readonly host?: TransportHost;
  /** The `stop` phase. */
  stop(deadlineMs: number): Promise<void>;
}

/**
 * The signature of the core's one boot entry point, `startRuntime(deployment, options)` (S-49),
 * which runs the lifecycle phases in order.
 */
export type StartRuntime = (
  deployment: DeploymentDefinition,
  options: RuntimeOptions,
) => Promise<Runtime>;
