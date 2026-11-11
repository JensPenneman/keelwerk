import type {
  AdapterCapabilities,
  AppliedMigration,
  DataAdapter,
  DataAdapterFactory,
  EntityDescriptor,
  JobAttempt,
  JobOutcome,
  NamespaceRef,
  StoredJob,
  StoredJobSpec,
  Unit,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';

function spied(unit: Unit, spy: JobSpy, pending: StoredJobSpec[]): Unit {
  return {
    ...unit,
    jobs: {
      ...unit.jobs,
      enqueue: async (job) => {
        await spy.beforeEnqueue?.(job);
        const id = await unit.jobs.enqueue(job);
        pending.push(job);
        return id;
      },
      take: async (queue, worker, request) => {
        if (spy.refuseTake?.(queue, worker) === true) return { jobs: [], skippedLanes: 0 };
        // Recorded when the call starts, so its index orders it against the commits that precede it.
        const entry = { queue, worker, jobs: [] as readonly StoredJob[] };
        spy.takes.push(entry);
        const taken = await unit.jobs.take(queue, worker, request);
        entry.jobs = taken.jobs;
        return taken;
      },
      complete: async (attempt, worker, outcome) => {
        const forced = spy.complete?.(attempt, outcome);
        const granted = forced ?? (await unit.jobs.complete(attempt, worker, outcome));
        spy.completions.push({ attempt, worker, outcome, granted });
        return granted;
      },
      heartbeat: async (attempts, worker, leaseMs) =>
        spy.heartbeat?.(attempts) ?? unit.jobs.heartbeat(attempts, worker, leaseMs),
    },
    receipts: {
      ...unit.receipts,
      claim: async (receipt) => {
        spy.beforeReceiptClaim?.(receipt.commandId);
        return unit.receipts.claim(receipt);
      },
      complete: async (commandId, outcome) => {
        await unit.receipts.complete(commandId, outcome);
        await spy.afterReceiptComplete?.();
      },
    },
  };
}

/** One call of `jobs.complete` and what the store answered. */
export interface Completion {
  readonly attempt: JobAttempt;
  readonly worker: string;
  readonly outcome: JobOutcome;
  readonly granted: boolean;
}

/** One call of `jobs.take` and the jobs it claimed. */
export interface Take {
  readonly queue: string;
  readonly worker: string;
  readonly jobs: readonly StoredJob[];
}

/** A job a committed unit enqueued, and how many takes had started by then. */
export interface Enqueued {
  readonly job: StoredJobSpec;
  /** `spy.takes.length` once the unit committed: the takes from this index on started after the commit. */
  readonly takesStarted: number;
}

/** A door a unit waits at: `entered` settles when one arrived, `release` lets every waiting unit through. */
export interface Gate {
  /** How many read-only units pass before the door holds one: the job's own read of its receipt passes, its principal resolution waits. */
  readonly after: number;
  /** The units that arrived. */
  arrivals: number;
  readonly entered: Promise<void>;
  readonly open: Promise<void>;
  enter(): void;
  release(): void;
}

export function gate(after = 0): Gate {
  const entered = Promise.withResolvers<void>();
  const open = Promise.withResolvers<void>();
  return {
    after,
    arrivals: 0,
    entered: entered.promise,
    open: open.promise,
    enter: () => entered.resolve(),
    release: () => open.resolve(),
  };
}

/** What a test changes of the in-memory adapter it runs on; every member may be set while the runtime runs. */
export interface JobSpy {
  readonly completions: Completion[];
  /** Every take of the job store, in the order the calls started (empty takes included). */
  readonly takes: Take[];
  /** The jobs of every unit that enqueued and committed, in commit order. */
  readonly enqueued: Enqueued[];
  /** Answers instead of the store when it returns a boolean. */
  complete?: ((attempt: JobAttempt, outcome: JobOutcome) => boolean | undefined) | undefined;
  /** Answers instead of the store when it returns attempts. */
  heartbeat?: ((attempts: readonly JobAttempt[]) => readonly JobAttempt[] | undefined) | undefined;
  /** Runs after `receipts.complete`, with the receipt row still held; a throw rolls the unit back, and the unit waits for a promise. */
  afterReceiptComplete?: (() => void | Promise<void>) | undefined;
  /** Runs when a unit is about to claim the receipt of a command id, before the store sees the call. */
  beforeReceiptClaim?: ((commandId: string) => void) | undefined;
  /** True: the take of this worker on this queue answers no job, without asking the store. */
  refuseTake?: ((queue: string, worker: string) => boolean) | undefined;
  /** Runs in a unit that is about to enqueue a job, before the store sees it; the unit waits for a promise. */
  beforeEnqueue?: ((job: StoredJobSpec) => void | Promise<void>) | undefined;
  /** A read-only unit waits for this gate before it opens (after the first `after` ones): the principal resolution of a job. */
  hold?: Gate;
  /** What the adapter of the app's placement reports at connect, merged over the in-memory capabilities. */
  capabilities?: Partial<AdapterCapabilities>;
  /** The migration history the adapter reports for a namespace; undefined passes the store's own. */
  history?: (namespace: NamespaceRef) => readonly AppliedMigration[] | undefined;
}

/**
 * The in-memory adapter, or the adapter factory `over` names, with its job and receipt stores
 * watched and, where the test says so, altered.
 */
export function jobSpy(
  entities: (ref: string) => EntityDescriptor | undefined,
  over?: DataAdapterFactory,
): {
  readonly spy: JobSpy;
  readonly factory: DataAdapterFactory;
} {
  const spy: JobSpy = { completions: [], takes: [], enqueued: [] };
  const base = over ?? memoryAdapter({ entities });
  const factory: DataAdapterFactory = {
    ...base,
    create: (placement, env): DataAdapter => {
      const adapter = base.create(placement, env);
      return {
        ...adapter,
        connect: async () => ({
          ...(await adapter.connect()),
          ...(placement.id === 'control' ? {} : spy.capabilities),
        }),
        schema: {
          ...adapter.schema,
          history: async (namespace) =>
            spy.history?.(namespace) ?? adapter.schema.history(namespace),
        },
        unit: async (namespace, scope, fn, options) => {
          if (options?.readOnly === true && spy.hold !== undefined) {
            spy.hold.arrivals += 1;
            if (spy.hold.arrivals > spy.hold.after) {
              spy.hold.enter();
              await spy.hold.open;
            }
          }
          const pending: StoredJobSpec[] = [];
          const result = await adapter.unit(
            namespace,
            scope,
            (unit) => fn(spied(unit, spy, pending)),
            options,
          );
          for (const job of pending) spy.enqueued.push({ job, takesStarted: spy.takes.length });
          return result;
        },
      };
    },
  };
  return { spy, factory };
}
