import type {
  Clock,
  DataAdapter,
  DataAdapterFactory,
  EgressPolicy,
  EventWorker,
  FlagProvider,
  Logger,
} from '@keelwerk/core';

/** What `startTestRuntime` takes; every member is optional. */
export interface TestRuntimeOptions<Name extends string = 'acme' | 'globex'> {
  /** The tenants to create, by name; default `['acme', 'globex']`. */
  readonly tenants?: readonly Name[];
  /** The API version a tenant is pinned to (its record's `apiVersion`), by name; default none, so the head answers. */
  readonly tenantApiVersions?: Readonly<Partial<Record<Name, string>>>;
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
  /**
   * Starts the kernel workers in the test runtime (role 'all'); absent: role 'serve' and no worker, so
   * asynchronous commands keep their `accepted` receipts. `true` gives every action queue four
   * slots; `{ queues }` gives each named queue four, and `capabilities` are the ones this process
   * advertises for effect jobs (21.2) and `egress` its outbound policy (12.3).
   */
  readonly workers?:
    | true
    | {
        readonly queues: readonly string[];
        readonly capabilities?: readonly string[];
        readonly egress?: EgressPolicy;
      };
  /** The seconds `stop` gives the running services before it abandons them (the runtime's `drainSeconds`, default 60); only with workers. */
  readonly drainSeconds?: number;
  /**
   * Attaches this runtime to a deployment that another runtime created on the same `external`
   * database, creating nothing: the backend and the tenants have these ids (`tenants` by name).
   * Needs `external`; `config` is then only what `TestRuntime.config` reads.
   */
  readonly join?: {
    readonly backendId: string;
    readonly tenants: Readonly<Record<string, string>>;
  };
  /**
   * Event workers added to the deployment's infrastructure (S-154), such as `consumers()` of
   * `@keelwerk/events`; the runtime then runs role 'all', so they and the kernel workers start.
   */
  readonly eventWorkers?: readonly EventWorker[];
  /**
   * The process environment the runtime reads flags from: `KEELWERK_FLAG_<MODULE>_<FLAG>` (20.3).
   * Read when a flag is resolved, so a test that changes the object it passed changes the flag.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Flag providers added to the deployment, after the targeting provider and before `env` (20.3). */
  readonly flagProviders?: readonly FlagProvider[];
}
