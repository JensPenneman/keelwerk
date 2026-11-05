import type { Clock, DataAdapter, DataAdapterFactory, Logger } from '@keelwerk/core';

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
  /**
   * Runs the app on an adapter factory and the database it names (a PostgreSQL started by the
   * test), instead of `adapter`. The factory gets the clock through its own options.
   */
  readonly external?: { readonly factory: DataAdapterFactory; readonly url: string };
  /** Where the runtime logs; default: the core's no-op logger. A test passes a capturing logger to read what was logged. */
  readonly logger?: Logger;
  /** The backend's configuration by module id (section 5.7), as `createBackend({ config })` takes it. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Whether a carrier whose principal holds the claim `operator: true` is an operator, as the CLI's local socket is (section 3.5); default false. */
  readonly operators?: boolean;
}
