/** The bounds of the schedule ticker (D9). */
export interface ScheduleLimits {
  /** The wall timer that re-checks for due ticks; every time the ticker compares reads the runtime clock. */
  readonly passEveryMs: number;
  /** Rows one `due()` read answers per namespace and pass. */
  readonly dueLimit: number;
  /** Ticks one backend gets per pass. */
  readonly perBackend: number;
  /** Backends ticking at once per namespace, each backend's rows one by one. */
  readonly concurrency: number;
  /** Scope units the seeding opens per namespace and pass. */
  readonly seedPerPass: number;
  /** Control rows per page. */
  readonly pageSize: number;
  /** A tick whose unit failed is tried again after this. */
  readonly retryMs: number;
  /** A stale row is looked at again after this. */
  readonly staleMs: number;
  /** Runtime-clock time between two full fan-outs over the backends and tenants. */
  readonly reseedMs: number;
  /** Wall time one backend's task keeps its slot: after it the task takes no further row and leaves the rest due. */
  readonly backendBudgetMs: number;
  /** Wall time one unit of the ticker may take: a slower one is abandoned (it commits nothing) and the row is tried again later. */
  readonly unitTimeoutMs: number;
}
