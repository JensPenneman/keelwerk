import type {
  AdapterEnvironment,
  Clock,
  DataAdapter,
  Invoker,
  KeyService,
  Logger,
  NamespaceRef,
} from '@keelwerk/core';
import type { TestTenant } from './test-tenant.ts';

/** A running test runtime: the app, the adapter it stores into, its tenants and the in-process invoker. */
export interface TestRuntime<App, Name extends string = string> {
  readonly app: App;
  readonly adapter: DataAdapter;
  /**
   * The placement as the kernel sees it: personal values are sealed on the way in and opened on the
   * way out, and conditions are rewritten onto the tags. `adapter` is the raw store beneath it.
   */
  readonly sealed: DataAdapter;
  /** The backend the runtime created for the app. */
  readonly backendId: string;
  /** The namespace the runtime provisioned for the app on its placement; every tenant's scope opens it. */
  readonly namespace: NamespaceRef;
  /** The key service over the runtime's control store and master key: the one a re-decide verifies and reveals with. */
  readonly keys: KeyService;
  /** The time source the runtime runs on (the system clock unless the options gave one). */
  readonly clock: Clock;
  /** What `ctx.config` answers for a module: the backend's stored configuration through the module's shape. */
  config(module: string): unknown;
  /** The log and tracer the runtime handed its adapter. */
  readonly log: Logger;
  readonly tracer: AdapterEnvironment['tracer'];
  readonly tenants: Readonly<Record<Name, TestTenant>>;
  readonly invoker: Invoker;
  /** The API version the runtime serves. */
  readonly head: string;
  /** Closes the adapter. */
  stop(): Promise<void>;
}
