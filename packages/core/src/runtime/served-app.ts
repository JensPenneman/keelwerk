import type { Registry } from '../registry/registry.ts';
import type { TransportAdapter } from '../transport/transport-adapter.ts';
import type { DeployedApp } from './deployed-app.ts';

/** An app as the process serves it, after `setup`. */
export interface ServedApp {
  readonly id: string;
  readonly source: DeployedApp;
  /** The registry the invoker runs: the composed one, with the runtime's answers for the introspection queries. */
  readonly registry: Registry;
  /** The app's head API version. */
  readonly head: string;
  readonly transports: readonly TransportAdapter[];
}
