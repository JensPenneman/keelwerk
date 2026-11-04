import type { Clock, DataAdapter } from '@keelwerk/core';

/** What `startTestRuntime` takes; every member is optional. */
export interface TestRuntimeOptions<Name extends string = 'acme' | 'globex'> {
  /** The tenants to create, by name; default `['acme', 'globex']`. */
  readonly tenants?: readonly Name[];
  /** The time source; default: the system clock. */
  readonly clock?: Clock;
  /** An adapter to run on; default: a fresh in-memory adapter. */
  readonly adapter?: DataAdapter;
}
