import type { RuntimeServiceContext } from '../../src/runtime/runtime-service-context.ts';
import type { ServedApp } from '../../src/runtime/served-app.ts';
import type { SchedulePassState } from '../../src/schedules/run-schedule-pass.ts';
import type { ScheduleLimits } from '../../src/schedules/schedule-limits.ts';
import type { StoredJobSpec } from '../../src/storage/stored-job-spec.ts';
import type { QueueSource } from '../../src/worker/queue-source.ts';

/** A fake deployment of backends with tenants in one namespace: the in-memory schedule table, the job log and the switches that make units fail. */
export interface PassWorld {
  readonly context: RuntimeServiceContext;
  readonly source: QueueSource;
  readonly served: ServedApp;
  readonly state: SchedulePassState;
  readonly rows: Map<string, { scopeId: string; scheduleId: string; nextTick: Temporal.Instant }>;
  readonly jobs: StoredJobSpec[];
  readonly logs: { level: string; message: string; fields: unknown }[];
  /** `afterEnqueue`: a tenant unit fails after its job was enqueued; its claim rolls back, the job stays. */
  readonly failing: { backends: Set<string>; claims: boolean; afterEnqueue: boolean };
  /** Directory records the world holds; a deleted tenant or backend is removed from them. */
  readonly backends: Map<string, unknown>;
  readonly tenantRecords: Map<string, { id: string; backendId: string }>;
  /** `scopeId\u0000scheduleId` of every row a unit removed. */
  readonly removed: string[];
  /** Wall time every tenant unit takes before it runs. */
  readonly slow: { ms: number };
  /** Directory reads. */
  readonly reads: { backend: number; tenant: number };
  /** Tenant ids whose status is suspended. */
  readonly suspended: Set<string>;
  /** Namespace units that claimed ticks. */
  readonly counts: { claimUnits: number };
  readonly clock: { now: Temporal.Instant };
  limits(over?: Partial<ScheduleLimits>): ScheduleLimits;
  pass(over?: Partial<ScheduleLimits>): Promise<void>;
  settle(): Promise<void>;
}
