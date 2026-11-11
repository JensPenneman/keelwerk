import type {
  AdapterCapabilities,
  AppliedMigration,
  DataAdapter,
  DataAdapterFactory,
  EntityDescriptor,
  JobAttempt,
  JobOutcome,
  NamespaceRef,
  Unit,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';

function spied(unit: Unit, spy: JobSpy): Unit {
  return {
    ...unit,
    jobs: {
      ...unit.jobs,
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
      complete: async (commandId, outcome) => {
        await unit.receipts.complete(commandId, outcome);
        spy.afterReceiptComplete?.();
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
  /** Answers instead of the store when it returns a boolean. */
  complete?: ((attempt: JobAttempt, outcome: JobOutcome) => boolean | undefined) | undefined;
  /** Answers instead of the store when it returns attempts. */
  heartbeat?: ((attempts: readonly JobAttempt[]) => readonly JobAttempt[] | undefined) | undefined;
  /** Runs after `receipts.complete`; a throw rolls the unit back. */
  afterReceiptComplete?: (() => void) | undefined;
  /** A read-only unit waits for this gate before it opens (after the first `after` ones): the principal resolution of a job. */
  hold?: Gate;
  /** What the adapter of the app's placement reports at connect, merged over the in-memory capabilities. */
  capabilities?: Partial<AdapterCapabilities>;
  /** The migration history the adapter reports for a namespace; undefined passes the store's own. */
  history?: (namespace: NamespaceRef) => readonly AppliedMigration[] | undefined;
}

/** The in-memory adapter with its job and receipt stores watched and, where the test says so, altered. */
export function jobSpy(entities: (ref: string) => EntityDescriptor | undefined): {
  readonly spy: JobSpy;
  readonly factory: DataAdapterFactory;
} {
  const spy: JobSpy = { completions: [] };
  const base = memoryAdapter({ entities });
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
          return adapter.unit(namespace, scope, (unit) => fn(spied(unit, spy)), options);
        },
      };
    },
  };
  return { spy, factory };
}
