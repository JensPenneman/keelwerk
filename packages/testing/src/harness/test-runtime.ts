import type {
  AdapterEnvironment,
  DataAdapter,
  Invoker,
  Logger,
  NamespaceRef,
} from '@keelwerk/core';
import type { TestTenant } from './test-tenant.ts';

/** A running test runtime: the app, the adapter it stores into, its tenants and the in-process invoker. */
export interface TestRuntime<App, Name extends string = string> {
  readonly app: App;
  readonly adapter: DataAdapter;
  /** The backend the runtime created for the app. */
  readonly backendId: string;
  /** The namespace the runtime provisioned for the app on its placement; every tenant's scope opens it. */
  readonly namespace: NamespaceRef;
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
