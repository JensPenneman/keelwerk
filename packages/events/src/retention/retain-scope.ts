import type {
  Clock,
  PurgeBatch,
  RetentionHorizons,
  RetentionRemoved,
  RetentionRun,
  RetentionRunRule,
  Unit,
  UnitGuard,
} from '@keelwerk/core';
import { durationMs, guardUnits, newUuidV7, transientPurgeTypes } from '@keelwerk/core';
import type { InsideUnit } from './inside-unit.ts';
import { purgeExpiredReceipts } from './purge-expired-receipts.ts';
import { purgeExpiredTickets } from './purge-expired-tickets.ts';
import type { RetainRules } from './retain-rules.ts';
import { RetentionHalted } from './retention-halted.ts';
import { retentionRuleOf } from './retention-rule-of.ts';
import { retentionRunError } from './retention-run-error.ts';
import type { RetentionScope } from './retention-scope.ts';
import { streamRetentionRule } from './stream-retention-rule.ts';

type BufferKind = RetentionRunRule['kind'];
/** One bounded batch in one unit: what it removed and whether candidates are left (`PurgeBatch`). */
type Batch = (unit: Unit) => Promise<PurgeBatch & { readonly valueKeys?: number }>;
type FixedBuffer = Exclude<BufferKind, 'streamRecords'>;

const millis = { fractionalSecondDigits: 3 } as const;

/** The instant a duration before `at`, at the millisecond the stores keep. */
function before(at: Temporal.Instant, duration: string): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(at.epochMilliseconds - durationMs(duration));
}

/**
 * What `retainScope` answers: the run of the scope (absent when nothing was removed and nothing
 * failed) and the buffers that failed, in the order they ran. The run holds the batches that
 * committed before each failure.
 */
export interface RetainResult {
  readonly run?: RetentionRun;
  readonly failures: readonly {
    readonly buffer: BufferKind;
    readonly stream?: string;
    readonly error: unknown;
  }[];
}

/** What `retainScope` is given. */
export interface RetainScopeInput {
  readonly scope: RetentionScope;
  /** The instant of the pass: every horizon is counted from it. */
  readonly now: Temporal.Instant;
  /** The runtime clock, which stamps the run's start and end. */
  readonly clock: Clock;
  readonly rules: RetainRules;
  readonly batchSize: number;
  /**
   * The most batches one buffer, or one declared stream, runs in this call. A buffer that is not
   * drained by then ends undrained, without a horizon, and the next pass takes it up again.
   */
  readonly maxBatches: number;
  /**
   * Asked before every batch: false ends the buffer undrained, the same way (the window of the
   * pass has ended, or the lease it runs on is lost). It may renew the lease as a side effect.
   */
  readonly mayContinue: () => Promise<boolean>;
  /** Runs inside every unit: fails it when the worker stopped or gave the work up. */
  readonly guard: UnitGuard;
  readonly insideUnit?: InsideUnit;
}

/**
 * The buffers of one scope, in the order of the run record: receipts first, because their purge is
 * the bound the stated limit of erasure relies on, then transient records (receipt change records
 * only, `transientPurgeTypes`), job history, ticket rows (not in the deployment scope), then each
 * stream with a declared retention that belongs to the scope. Each batch is one writing unit of the
 * scope's own namespace and a buffer repeats while a batch says candidates are left, up to
 * `maxBatches` batches and while `mayContinue` agrees, so a unit holds at most `batchSize` rows of
 * one buffer and never spans two scopes, and one call removes at most `maxBatches * batchSize`
 * rows of each buffer. Each buffer and each
 * stream has its own failure: a unit that fails ends only that buffer, which keeps the count of
 * the batches that committed, stays listed in the run, gets no horizon and is reported in
 * `failures`; the next buffer begins. A halt throws `RetentionHalted`, whatever failed before, and
 * no run is recorded. Answers the run of the scope when it removed anything or failed: its outcome
 * is 'failed' when any buffer failed, with the error of the first. The run lists the rules the
 * scope began, counts only those buffers, and gives a horizon only to a buffer whose last batch
 * said, from a read of committed data and not from its own size, that no candidate is left.
 */
export async function retainScope(input: RetainScopeInput): Promise<RetainResult> {
  const { scope, now, rules, batchSize } = input;
  const { registry, target } = scope;
  const guarded = guardUnits(target.handle.adapter, input.guard);
  const startedAt = input.clock.now();
  const horizonOf: Record<FixedBuffer, Temporal.Instant> = {
    transientRecords: before(now, rules.transientRecords),
    receipts: now,
    jobHistory: before(now, rules.jobHistory),
    streamTickets: before(now, rules.streamTickets),
  };
  const inUnit = <T>(buffer: BufferKind, work: (unit: Unit) => Promise<T>) =>
    guarded.unit(target.namespace, target.scope, async (unit) => {
      await input.insideUnit?.(target.scope, buffer);
      return work(unit);
    });
  const applied: RetentionRunRule[] = [];
  const counts = {
    transientRecords: 0,
    receipts: 0,
    valueKeys: 0,
    jobHistory: 0,
    streamTickets: 0,
  };
  const began = new Set<FixedBuffer>();
  const drained = new Set<FixedBuffer>();
  const streamRecords: Record<string, number> = {};
  const failures: RetainResult['failures'][number][] = [];
  /**
   * Repeats `batch` while it says candidates are left; `add` runs only after that batch's unit
   * committed. True when the buffer drained: the last batch said nothing is left. A batch that
   * removed nothing although candidates are left ends the buffer undrained: other units hold them.
   * So does a buffer that used its `maxBatches`, and one that `mayContinue` stops before a batch.
   */
  const step = async (
    buffer: BufferKind,
    batch: Batch,
    add: (removed: number, keys: number) => void,
  ) => {
    for (let batches = 0; ; ) {
      if (!(await input.mayContinue())) return false;
      const result = await inUnit(buffer, batch);
      batches += 1;
      add(result.removed, result.valueKeys ?? 0);
      if (!result.more) return true;
      if (result.removed === 0 || batches >= input.maxBatches) return false;
    }
  };
  /**
   * Runs one buffer's work. A halt is thrown on, discarding the partial counts: the batches that
   * committed before it are not recorded, so nothing may derive a horizon from the run rows alone.
   * Any other error ends this buffer only.
   */
  const isolated = async (
    kind: BufferKind,
    stream: string | undefined,
    work: () => Promise<void>,
  ): Promise<void> => {
    try {
      await work();
    } catch (error) {
      if (error instanceof RetentionHalted) throw error;
      failures.push({ buffer: kind, ...(stream === undefined ? {} : { stream }), error });
    }
  };
  /** One of the four buffers: its rule is applied from here on, its horizon set when it drained. */
  const buffer = (kind: FixedBuffer, batch: Batch): Promise<void> => {
    applied.push(retentionRuleOf(kind, rules));
    began.add(kind);
    return isolated(kind, undefined, async () => {
      const done = await step(kind, batch, (removed, keys) => {
        counts[kind] += removed;
        if (kind === 'receipts') counts.valueKeys += keys;
      });
      if (done) drained.add(kind);
    });
  };
  await buffer('receipts', async (unit) => {
    const purged = await purgeExpiredReceipts(unit, registry, now, batchSize);
    return { removed: purged.receipts, valueKeys: purged.valueKeys, more: purged.more };
  });
  await buffer('transientRecords', async (unit) => {
    return unit.events.purgeTransient(horizonOf.transientRecords, batchSize, transientPurgeTypes);
  });
  await buffer('jobHistory', async (unit) => {
    return unit.jobs.purgeHistory(horizonOf.jobHistory, batchSize);
  });
  // Tickets live in the tenant or backend scope that issued them, never in the deployment's.
  if (target.scope.level !== 'deployment') {
    await buffer('streamTickets', async (unit) => {
      return purgeExpiredTickets(unit, registry, horizonOf.streamTickets, batchSize);
    });
  }
  for (const entry of registry.streams.values()) {
    if (entry.retention === undefined) continue;
    // A stream's records live in the scope its entity belongs to; an invocation entity's in any.
    const tenancy = registry.entities.get(entry.readAs)?.descriptor.tenancy;
    if (tenancy !== undefined && tenancy !== 'invocation' && tenancy !== target.scope.level)
      continue;
    const retention = entry.retention;
    applied.push(streamRetentionRule(entry.ref, retention));
    streamRecords[entry.ref] = 0;
    await isolated('streamRecords', entry.ref, async () => {
      await step(
        'streamRecords',
        async (unit) => {
          const count = await unit.streams.expire(entry.ref, retention, batchSize);
          // Declared stream retention has no horizon: a full batch means another may be due.
          return { removed: count, more: count === batchSize };
        },
        (count) => {
          streamRecords[entry.ref] = (streamRecords[entry.ref] ?? 0) + count;
        },
      );
    });
  }

  const nothing =
    counts.transientRecords + counts.receipts + counts.jobHistory + counts.streamTickets === 0 &&
    Object.values(streamRecords).every((count) => count === 0);
  const first = failures[0];
  if (nothing && first === undefined) return { failures };
  const removed: RetentionRemoved = {
    ...(began.has('receipts') ? { receipts: counts.receipts, valueKeys: counts.valueKeys } : {}),
    ...(began.has('transientRecords') ? { transientRecords: counts.transientRecords } : {}),
    ...(began.has('jobHistory') ? { jobHistory: counts.jobHistory } : {}),
    ...(began.has('streamTickets') ? { streamTickets: counts.streamTickets } : {}),
    ...(applied.some((rule) => rule.kind === 'streamRecords') ? { streamRecords } : {}),
  };
  const horizons: RetentionHorizons = Object.fromEntries(
    [...drained].map((kind) => [kind, horizonOf[kind].toString(millis)]),
  );
  const run: RetentionRun = {
    runId: newUuidV7(),
    startedAt,
    endedAt: input.clock.now(),
    namespaceId: target.namespace.id,
    backendId: scope.backendId,
    tenantId: scope.tenantId,
    outcome: first === undefined ? 'complete' : 'failed',
    error: first === undefined ? null : retentionRunError(first.error),
    rule: { rules: applied },
    removed,
    horizons,
  };
  return { run, failures };
}
