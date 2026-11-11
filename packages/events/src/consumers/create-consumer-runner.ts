import type {
  Clock,
  ConsumerSpec,
  Logger,
  Position,
  QueueSource,
  ScopeLookup,
  ScopeTarget,
  StreamRef,
  Unit,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { answerFailedBatch } from './answer-failed-batch.ts';
import type { ConsumerPass, ConsumerRunner } from './consumer-runner.ts';
import { createConsumerLease } from './create-consumer-lease.ts';
import type { FailedBatchState } from './failed-batch-state.ts';
import { handOverLease } from './hand-over-lease.ts';
import { movedScopesOf } from './moved-scopes-of.ts';
import { replayParkedStreams } from './replay-parked-streams.ts';
import { runScopeBatch } from './run-scope-batch.ts';
import { scopeTargetOf } from './scope-target-of.ts';
import { unparkStream } from './unpark-stream.ts';

/** How long a scope waits after a failure outside `consume`, and after a limit without a retry hint. */
const holdMs = 1000;
const defaultMaxAttempts = 5;
const namespaceScope = { level: 'namespace', reason: 'consumer sweep' } as const;
const startScope = { level: 'namespace', reason: 'consumer start' } as const;

/** What a runner is built from. */
export interface ConsumerRunnerInput {
  readonly spec: ConsumerSpec;
  readonly source: QueueSource;
  readonly directory: ScopeLookup;
  /** `ControlStore.deploymentId`: the scope id of deployment-scope units. */
  readonly deploymentId: string;
  readonly owner: string;
  readonly leaseMs: number;
  readonly batchSize: number;
  readonly clock: Clock;
  readonly log: Logger;
  /** D8: false while the namespace misses framework step 0002; the runner then takes no lease. */
  readonly ready: () => Promise<boolean>;
}

/**
 * The runner of one consumer in one namespace (15.2.3, D1 to D7). It holds the namespace's lease for
 * the consumer, learns scopes from wake-ups and from `movedScopes`, and serves them round-robin, one
 * batch in one unit of the scope per turn, so a busy scope delays a quiet one by one batch. A batch
 * that fails is retried alone, event by event, and an event that fails `maxAttempts` times parks its
 * stream. Passes, replays and the lease hand-over never overlap: they run one after the other.
 */
export function createConsumerRunner(input: ConsumerRunnerInput): ConsumerRunner {
  const { spec, source, directory, deploymentId, owner, batchSize, clock, log } = input;
  const maxAttempts = spec.maxAttempts ?? defaultMaxAttempts;
  // A batch, a start or a replay that outlasts a third of the lease fails inside its unit.
  const deadlineMs = Math.max(1, Math.floor(input.leaseMs / 3));
  const lease = createConsumerLease({
    consumer: spec.id,
    source,
    owner,
    leaseMs: input.leaseMs,
    clock,
    log,
  });
  const later = (a: Temporal.Instant, b: Temporal.Instant): boolean =>
    Temporal.Instant.compare(a, b) > 0;
  /** The scopes waiting for a turn, in order. */
  const pending: string[] = [];
  /** Scopes held until an instant: a limit, or a failure outside `consume`. */
  const holds = new Map<string, Temporal.Instant>();
  /** Scopes read one event at a time until the position, after a failed batch. */
  const singles = new Map<string, Position>();
  /** The event a scope is failing on and the deliveries that failed so far. */
  const failing = new Map<string, { readonly eventId: string; readonly count: number }>();
  /** Work its deadline abandoned, until it settles: while it is not empty the lease is not handed over. */
  const abandoned = new Set<Promise<unknown>>();
  /** The position through which this runner has read each scope, for `movedScopes`. */
  const known = new Map<string, Position>();
  const unmapped = new Set<string>();
  /**
   * Whether the consumer has started (15.2.3): a `start: 'beginning'` consumer always has, a `now`
   * consumer once `startAtHeads` answered. The start is durable, so a lost lease keeps it.
   */
  let begun = spec.start === 'beginning';
  /** A lease was acquired and the sweep and the replay of parked streams that follow it have not both succeeded yet. */
  let acquired = false;
  let stopping = false;
  let tail: Promise<unknown> = Promise.resolve();

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
  const enqueue = (scopeId: string): void => {
    if (!pending.includes(scopeId)) pending.push(scopeId);
  };
  const lose = (): void => {
    pending.length = 0;
    holds.clear();
    singles.clear();
    failing.clear();
    known.clear();
  };
  const hold = (scopeId: string, ms: number): void => {
    holds.set(scopeId, clock.now().add({ milliseconds: ms }));
    enqueue(scopeId);
  };
  const nextDue = (): string | undefined => {
    const now = clock.now();
    const index = pending.findIndex((scopeId) => {
      const until = holds.get(scopeId);
      return until === undefined || !later(until, now);
    });
    if (index < 0) return undefined;
    const [scopeId] = pending.splice(index, 1);
    if (scopeId !== undefined) holds.delete(scopeId);
    return scopeId;
  };
  const targetOf = async (scopeId: string): Promise<ScopeTarget | undefined> => {
    const target = await scopeTargetOf({ source, scopeId, directory, deploymentId });
    if (target === undefined && !unmapped.has(scopeId)) {
      unmapped.add(scopeId);
      log.warn('a consumer left a scope its namespace cannot place', {
        consumer: spec.id,
        scope: scopeId,
        namespace: source.namespace.id,
      });
    }
    return target;
  };
  const inNamespace = <T>(work: (unit: Unit) => Promise<T>): Promise<T> =>
    source.handle.adapter.unit(source.namespace, namespaceScope, work, { readOnly: true });

  /** Queues the scopes that moved since this runner read them. */
  const sweep = async (): Promise<void> => {
    for (const entry of await movedScopesOf(source, known)) enqueue(entry.scopeId);
  };

  const failure: FailedBatchState = {
    spec,
    maxAttempts,
    holdMs,
    log,
    singles,
    failing,
    hold,
    enqueue,
  };

  /** Runs one batch of a scope; true when a unit committed. */
  const turn = async (scopeId: string): Promise<boolean> => {
    const target = await targetOf(scopeId);
    if (target === undefined) return false;
    // A scope this runner has read to its head needs no batch until it moves: a batch writes, and on
    // adapters whose feed wakes after every writing unit it would wake itself again and again.
    const seen = known.get(scopeId);
    if (seen !== undefined) {
      const head = await target.handle.adapter.unit(
        target.namespace,
        target.scope,
        (unit) => unit.events.head(),
        { readOnly: true },
      );
      if (head === null || head <= seen) return false;
    }
    const single = singles.get(scopeId);
    const result = await runScopeBatch({
      spec,
      target,
      scopeId,
      limit: single === undefined ? batchSize : 1,
      deadlineMs,
      log,
      abandoned,
    });
    if (result.kind === 'failed') {
      await answerFailedBatch(failure, scopeId, target, result);
      return false;
    }
    failing.delete(scopeId);
    if (result.to !== null) {
      known.set(scopeId, result.to);
      if (single !== undefined && result.to >= single) singles.delete(scopeId);
    }
    if (result.kind === 'more') enqueue(scopeId);
    return true;
  };

  /**
   * True while this runner may begin more work: it is not stopping and holds the lease, renewed when
   * due. A failed renewal drops the runner's state, as a lost lease does.
   */
  const holding = async (): Promise<boolean> => {
    if (stopping || !lease.holds()) return false;
    if (Temporal.Instant.compare(clock.now(), lease.dueAt()) >= 0 && !(await lease.renew())) {
      lose();
      return false;
    }
    return true;
  };

  /**
   * The start of a `start: 'now'` consumer (15.2.3): one writing namespace unit records it and gives
   * every scope that has events a checkpoint at the head it reads, so nothing of the history is ever
   * delivered. True once the consumer has started, here or earlier; false when the start failed and
   * the pass must end. Either answer of the store counts: a start that committed with its answer lost
   * is asked again and answers that it had started.
   */
  const start = async (): Promise<boolean> => {
    try {
      const started = await source.handle.adapter.unit(source.namespace, startScope, (unit) =>
        unit.consumers.startAtHeads(spec.id),
      );
      begun = true;
      if (started) {
        log.info('a consumer started at the heads of its namespace', {
          consumer: spec.id,
          namespace: source.namespace.id,
        });
      }
      return true;
    } catch (cause) {
      log.warn('a consumer could not start', {
        consumer: spec.id,
        namespace: source.namespace.id,
        cause,
      });
      return false;
    }
  };

  const pass = (options?: { readonly sweep?: boolean }): Promise<ConsumerPass> =>
    serial(async (): Promise<ConsumerPass> => {
      if (stopping || !(await input.ready())) return { holding: false, batches: 0 };
      if (Temporal.Instant.compare(clock.now(), lease.dueAt()) >= 0) {
        if (lease.holds()) {
          if (!(await lease.renew())) lose();
        } else if (await lease.acquire()) acquired = true;
      }
      if (!lease.holds()) return { holding: false, batches: 0 };
      if (!begun) {
        // Nothing else happens before the consumer has started: no sweep, no replay, no batch.
        if (!(await holding()) || !(await start())) return { holding: lease.holds(), batches: 0 };
      }
      if (acquired) {
        // The decision that follows an acquisition is retried in every pass until it has succeeded.
        if (!(await holding())) return { holding: lease.holds(), batches: 0 };
        await sweep();
        const replayed = await replayParkedStreams({
          spec,
          source,
          batchSize,
          deadlineMs,
          log,
          abandoned,
          targetOf,
          inNamespace,
          proceed: holding,
        });
        if (replayed) acquired = false;
      } else if (options?.sweep === true) await sweep();
      let batches = 0;
      while (await holding()) {
        const scopeId = nextDue();
        if (scopeId === undefined) break;
        try {
          if (await turn(scopeId)) batches += 1;
        } catch (error) {
          log.warn('a consumer turn failed', { consumer: spec.id, scope: scopeId, cause: error });
          hold(scopeId, holdMs);
        }
      }
      return { holding: lease.holds(), batches };
    });

  return {
    consumer: spec.id,
    namespace: source.namespace,
    wake: (scopeIds) => {
      if (stopping || !lease.holds()) return;
      for (const scopeId of scopeIds) enqueue(scopeId);
    },
    pass,
    unpark: (scopeId: string, stream: StreamRef) =>
      serial(async () => {
        // Only the holder of the lease replays: a standby, or a runner that has stopped, would run
        // `consume` beside the holder.
        if (!(await holding())) {
          throw errors.unavailable('This process does not hold the lease of the consumer.');
        }
        const target = await targetOf(scopeId);
        if (target === undefined) {
          throw errors.not_found('The scope is not served by this namespace.');
        }
        return unparkStream({
          spec,
          target,
          scopeId,
          stream,
          batchSize,
          deadlineMs,
          log,
          abandoned,
          proceed: holding,
        });
      }),
    dueAt: () => {
      const now = clock.now();
      let due = lease.dueAt();
      for (const scopeId of pending) {
        const until = holds.get(scopeId) ?? now;
        if (later(due, until)) due = until;
      }
      return due;
    },
    halt: () => {
      stopping = true;
    },
    stop: (deadline) => {
      stopping = true;
      return handOverLease({
        consumer: spec.id,
        namespace: source.namespace.id,
        idle: tail,
        abandoned,
        release: () => serial(() => lease.release()),
        deadline,
        log,
      });
    },
  };
}
