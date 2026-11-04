import type { DataAdapter, Invoker } from '@keelwerk/core';
import type { TestTenant } from './test-tenant.ts';

/** A running test runtime: the app, the adapter it stores into, its tenants and the in-process invoker. */
export interface TestRuntime<App, Name extends string = string> {
  readonly app: App;
  readonly adapter: DataAdapter;
  readonly tenants: Readonly<Record<Name, TestTenant>>;
  readonly invoker: Invoker;
  /** The API version the runtime serves. */
  readonly head: string;
  /** Closes the adapter. */
  stop(): Promise<void>;
}
