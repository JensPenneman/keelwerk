import type { Clock, DataAdapter } from '@keelwerk/core';

/** What `startTestRuntime` takes; every member is optional. */
export interface TestRuntimeOptions<Name extends string = 'acme' | 'globex'> {
  /** The tenants to create, by name; default `['acme', 'globex']`. */
  readonly tenants?: readonly Name[];
  /** The time source; default: the system clock. */
  readonly clock?: Clock;
  /**
   * What the app is stored in: `'memory'` (the default), `'pglite'` (an in-process PostgreSQL,
   * from `@keelwerk/data/pglite`), or an adapter to run on.
   */
  readonly adapter?: 'memory' | 'pglite' | DataAdapter;
  /** The backend's configuration by module id (section 5.7), as `createBackend({ config })` takes it. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Whether a carrier whose principal holds the claim `operator: true` is an operator, as the CLI's local socket is (section 3.5); default false. */
  readonly operators?: boolean;
}
