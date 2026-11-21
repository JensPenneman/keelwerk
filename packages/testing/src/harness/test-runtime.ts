import type {
  AdapterEnvironment,
  Clock,
  DataAdapter,
  HostFetchOptions,
  Invoker,
  KeyService,
  Logger,
  NamespaceRef,
  RebuildReport,
  RuntimeControl,
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
  /** The control store the runtime runs on, to read the rows and events of the `core.*` entities as stored. */
  readonly control: {
    readonly adapter: DataAdapter;
    readonly namespace: NamespaceRef;
    /** Writes the buffered API usage counts to `kw_api_usage` now. */
    readonly apiUsage: NonNullable<RuntimeControl['apiUsage']>;
  };
  /** The key service over the runtime's control store and master key: the one a re-decide verifies and reveals with. */
  readonly keys: KeyService;
  /** The time source the runtime runs on: the options' clock or the system clock, until `advanceTo` pins it. */
  readonly clock: Clock;
  /** What `ctx.config` answers for a module: the backend's stored configuration through the module's shape. */
  config(module: string): unknown;
  /** The log and tracer the runtime handed its adapter. */
  readonly log: Logger;
  readonly tracer: AdapterEnvironment['tracer'];
  readonly tenants: Readonly<Record<Name, TestTenant>>;
  readonly invoker: Invoker;
  /**
   * Sends a request through the HTTP host of `host` (`runtime.host.fetch`, no port). Each request comes
   * from its own client address unless `options.remoteAddress` names one. Rejects with a TypeError when
   * the runtime was started without `host`.
   */
  fetch(request: Request, options?: HostFetchOptions): Promise<Response>;
  /** The API version the runtime serves. */
  readonly head: string;
  /**
   * Runs the jobs that a commit's wake-up or a step of the clock has made takeable by the time it
   * starts, as the workers' slots free up, and settles once the workers are idle; answers the
   * attempts they settled since the previous drain of this runtime, those a commit woke them for
   * included. It also runs what the attended services (the schedule pass among them) enqueue
   * during the drain. It sweeps where a wake-up or the clock can have made such a job takeable:
   * the queues a commit's wake-up named since their last sweep came to rest, every queue whose
   * last sweep did not come to rest, and every queue when the clock has moved since, or the
   * adapter serves more than one process, or its feed polls. A job that no wake-up named waits for
   * the poll, so it is left until the clock moves. One known case is a job freed by provisioning a
   * namespace, which sets the limits of its job groups without a wake-up; any other job left at a
   * still clock points to a missing wake-up in the store or to a mistake in the test. A job made
   * takeable while a drain runs may be left to the next drain (`settleReactions` runs it in its
   * next round). A reclaim, a promotion or the release of a FIFO successor that a take left behind
   * a lock another unit held is no skipped lane: the next take of the queue does it, brought by the
   * wake-up of the holder's commit, a slot that frees or the poll, so at a still clock a drain can
   * settle while such work is left, until the clock moves or another take runs. A test double that
   * holds a job back answers its take with a skipped lane, not with no job; the fetcher then retakes
   * after a pause on `setTimeout`, so under fake timers such a drain does not settle. Throws without
   * `workers`.
   */
  drainJobs(): Promise<number>;
  /**
   * Pins the clock at `at` (RangeError when earlier than now), then drains the jobs as `drainJobs`
   * does when workers run, else answers 0.
   */
  advanceTo(at: Temporal.Instant): Promise<number>;
  /** `runtime.control.rebuild` of the tenant's id; default the first tenant. */
  rebuild(tenant?: Name): Promise<RebuildReport>;
  /** Every later re-resolution of the subject answers null (a revoked credential). */
  revoke(subject: string): void;
  /** Stops the runtime: running jobs may finish for `deadlineMs` (default 0), then the adapter closes. */
  stop(deadlineMs?: number): Promise<void>;
}
