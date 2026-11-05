import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Clock } from '../kernel/clock.ts';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import type { Logger } from '../observability/logger.ts';
import { anchorCadenceMs } from './anchor-cadence-ms.ts';
import type { AnchorSinkStatus } from './anchor-sink-status.ts';
import type { AnchorWriter } from './anchor-writer.ts';
import { latestChainEvent } from './latest-chain-event.ts';

/** What the anchor writer needs. */
export interface AnchorWriterOptions {
  readonly sinks: readonly LedgerSink[];
  /** `defineDeployment({ anchors: { every } })`: `'batch'` (the default) or an ISO 8601 duration. */
  readonly every?: string;
  readonly clock: Clock;
  /** The process and build that appear as the writer of each anchor. */
  readonly writer: { readonly process: string; readonly build: string };
  /** The unit targets of the scope ids a batch names; ids that resolve to nothing are left out. */
  readonly resolve: (scopeIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ScopeTarget>>;
  readonly log: Logger;
  /** The positions already anchored in the sinks: those scopes are not anchored again at the same position. */
  readonly known?: ReadonlyMap<string, bigint>;
}

/**
 * The anchor writer (decision 35b). Batches are handled one after the other. Per scope it keeps
 * the position it last anchored and when, so a scope whose head has not moved is not anchored
 * again and a scope is anchored at most once per cadence. A scope that was held back, or whose
 * anchor failed, stays waiting; one timer, set to the time left of the soonest cadence, brings
 * it back without another batch, and the next batch that names it or `flush` does too. A scope
 * leaves the waiting set only once its anchor was appended or it has nothing to anchor. A sink
 * that fails is logged and the batch still reaches the others. Without sinks the writer does
 * nothing.
 */
export function createAnchorWriter(options: AnchorWriterOptions): AnchorWriter {
  const { sinks, clock, log } = options;
  const cadence = anchorCadenceMs(options.every);
  const anchored = new Map<string, { position: bigint; at: number }>();
  const waiting = new Set<string>();
  const refusals = new Map<string, { count: number; at: string; message: string }>();
  // An anchor pins the newest chained event; a scope whose head is a transient record is not anchored again at the same position (S-87).
  for (const [id, position] of options.known ?? []) {
    anchored.set(id, { position, at: Number.NEGATIVE_INFINITY });
  }
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };

  const arm = (): void => {
    if (timer !== undefined || waiting.size === 0) return;
    const now = clock.now().epochMilliseconds;
    let delay = cadence;
    for (const id of waiting) {
      const last = anchored.get(id);
      if (last !== undefined && last.at + cadence > now)
        delay = Math.min(delay, last.at + cadence - now);
    }
    timer = setTimeout(() => {
      timer = undefined;
      run(new Set(waiting), false).catch((error: unknown) => {
        log.error('the chain anchors could not be written', { cause: error });
      });
    }, delay);
    timer.unref();
  };

  const anchorScopes = async (ids: ReadonlySet<string>, force: boolean): Promise<void> => {
    const due = new Set<string>();
    const now = clock.now().epochMilliseconds;
    for (const id of ids) {
      const last = anchored.get(id);
      if (force || last === undefined || now - last.at >= cadence) due.add(id);
      else waiting.add(id);
    }
    if (due.size === 0) {
      arm();
      return;
    }
    try {
      let targets: ReadonlyMap<string, ScopeTarget>;
      try {
        targets = await options.resolve(due);
      } catch (error) {
        for (const id of due) waiting.add(id);
        throw error;
      }
      const records: LedgerRecord[] = [];
      const positions = new Map<string, bigint>();
      const settled = new Set<string>(due);
      for (const [id, target] of targets) {
        try {
          const event = await target.handle.adapter.unit(
            target.namespace,
            target.scope,
            (unit) => latestChainEvent(unit),
            { readOnly: true },
          );
          if (event === null || event.hash === null) continue;
          if (anchored.get(id)?.position === event.position) continue;
          positions.set(id, event.position);
          records.push({
            type: 'anchor',
            scopeId: id,
            position: event.position.toString(),
            hash: event.hash,
            stream: { type: event.stream.type, id: event.stream.id },
            // Stored forever (S-34): milliseconds, floored, three digits, like every stored instant.
            recordedAt: clock
              .now()
              .round({ smallestUnit: 'millisecond', roundingMode: 'floor' })
              .toString({ fractionalSecondDigits: 3 }),
            writer: options.writer,
          });
        } catch (error) {
          settled.delete(id);
          waiting.add(id);
          log.error('the chain head of a scope could not be read for its anchor', {
            scopeId: id,
            cause: error,
          });
        }
      }
      for (const id of settled) {
        if (!positions.has(id)) waiting.delete(id);
      }
      if (records.length === 0) return;
      const results = await Promise.allSettled(sinks.map((sink) => sink.append(records)));
      const failed = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [{ sink: sinks[index]?.id, cause: result.reason as unknown }]
          : [],
      );
      for (const failure of failed) {
        const key = failure.sink ?? 'unknown';
        refusals.set(key, {
          count: (refusals.get(key)?.count ?? 0) + 1,
          at: clock.now().toString(),
          message: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
        });
        log.error('a ledger sink did not take the chain anchors', failure);
      }
      // One sink that took the batch keeps the anchor in the ledger; none: try again at the next chance.
      const taken = failed.length < sinks.length;
      for (const [id, position] of positions) {
        if (taken) {
          anchored.set(id, { position, at: now });
          waiting.delete(id);
        } else waiting.add(id);
      }
    } finally {
      arm();
    }
  };

  const run = (ids: ReadonlySet<string>, force: boolean): Promise<void> => {
    const done = queue.then(() => anchorScopes(ids, force));
    queue = done.catch(() => undefined);
    return done;
  };

  return {
    onBatch: (scopeIds) =>
      sinks.length === 0 ? Promise.resolve() : run(new Set([...scopeIds, ...waiting]), false),
    anchorNow: (scopeIds) =>
      sinks.length === 0 ? Promise.resolve() : run(new Set([...scopeIds, ...waiting]), true),
    flush: () => {
      if (sinks.length === 0) return Promise.resolve();
      disarm();
      return run(new Set(waiting), true).finally(disarm);
    },
    sinkStatus: (): readonly AnchorSinkStatus[] =>
      sinks.map((sink) => {
        const last = refusals.get(sink.id);
        return {
          sink: sink.id,
          refusedAppends: sink.refusedAppends?.() ?? last?.count ?? 0,
          ...(last === undefined ? {} : { lastFailure: { at: last.at, message: last.message } }),
        };
      }),
    anchoredPositions: () => new Map([...anchored].map(([id, entry]) => [id, entry.position])),
  };
}
