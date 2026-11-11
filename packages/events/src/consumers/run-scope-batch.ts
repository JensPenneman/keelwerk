import type { ConsumerSpec, Logger, Position, ScopeTarget, StoredEvent } from '@keelwerk/core';
import { lockCheckpoint } from './lock-checkpoint.ts';
import { parkedError } from './parked-error.ts';
import type { ScopeBatchResult } from './scope-batch-result.ts';
import { withinDeadline } from './within-deadline.ts';

const skipped = new Error('the event belongs to a parked stream');

/** What one batch of one scope is run with. */
export interface ScopeBatchInput {
  readonly spec: ConsumerSpec;
  readonly target: ScopeTarget;
  readonly scopeId: string;
  /** Events to read at most. */
  readonly limit: number;
  /** The batch fails when its unit's work has not settled by then (real time): lock, reads and `consume`. */
  readonly deadlineMs: number;
  /** Receives the late failure of work the deadline abandoned. */
  readonly log: Logger;
  /** Lists the work the deadline abandoned until it settles; the runner's handover reads it. */
  readonly abandoned?: Set<Promise<unknown>>;
}

/**
 * One batch of one scope in one unit of that scope (D3, D5, D6): lock the checkpoint, read the
 * events after it as they are stored, skip and record those of parked streams, hand the rest to
 * `consume` together with the unit, and advance the checkpoint, so the effects and the advance
 * commit together. A failure rolls the unit back and is answered, never thrown. The whole work of the
 * unit is raced against the deadline, the lock and the reads as well as `consume`: work that outlasts
 * it fails inside the unit, which rolls back and frees the scope's checkpoint lock, and what it still
 * sends is refused by the adapter. A deadline that passes while `consume` runs counts as its failure.
 */
export async function runScopeBatch(input: ScopeBatchInput): Promise<ScopeBatchResult> {
  const { spec, target, scopeId, limit, deadlineMs, log, abandoned } = input;
  const progress: {
    consuming: readonly StoredEvent[];
    read: number;
    readTo: Position | null;
    failure?: { readonly error: unknown };
  } = { consuming: [], read: 0, readTo: null };
  // What the batch had done when the deadline fired: `consume` may resolve while the unit rolls
  // back and clear `progress`, which must not hide that the events were in `consume`.
  let atExpiry:
    | { consuming: readonly StoredEvent[]; read: number; readTo: Position | null }
    | undefined;
  try {
    return await target.handle.adapter.unit(target.namespace, target.scope, (unit) =>
      withinDeadline(
        deadlineMs,
        {
          onLate: (error) => {
            log.warn('work of a consumer failed after its deadline and was refused', {
              consumer: spec.id,
              scope: scopeId,
              cause: error,
            });
          },
          onExpire: () => {
            atExpiry = {
              consuming: progress.consuming,
              read: progress.read,
              readTo: progress.readTo,
            };
          },
          ...(abandoned === undefined ? {} : { abandoned }),
        },
        async (expired): Promise<ScopeBatchResult> => {
          const at = await lockCheckpoint(unit, spec.id, scopeId);
          const head = await unit.events.head();
          const parked = new Set(
            (await unit.consumers.parked(spec.id)).map(
              (row) => `${row.stream.type}\u0000${row.stream.id}`,
            ),
          );
          const page = await unit.events.readAll(at, {
            limit,
            selector: spec.selector,
            includeTransient: true,
          });
          progress.read = page.events.length;
          progress.readTo = page.events.at(-1)?.position ?? null;
          const deliver: StoredEvent[] = [];
          for (const event of page.events) {
            if (parked.has(`${event.stream.type}\u0000${event.stream.id}`)) {
              // A read that was already on its way when the deadline fired comes back late: the
              // abandoned body must not park anything.
              expired();
              await unit.consumers.park(
                spec.id,
                event.stream,
                event.position,
                parkedError(skipped, event),
              );
            } else deliver.push(event);
          }
          if (deliver.length > 0) {
            // ... nor hand events to `consume`, whose calls reach outside the unit.
            expired();
            progress.consuming = deliver;
            try {
              await spec.consume(deliver, unit);
            } catch (error) {
              progress.failure = { error };
              throw error;
            }
            progress.consuming = [];
          }
          const full = page.events.length >= limit;
          // A short read reached the end of the log: a narrow selector then does not rescan (D3).
          const reached = page.events.at(-1)?.position ?? page.next ?? at;
          const to =
            !full && head !== null && (reached === null || head > reached) ? head : reached;
          if (to !== null) await unit.consumers.advance(spec.id, scopeId, to);
          return { kind: full ? 'more' : 'caughtUp', delivered: deliver.length, to };
        },
      ),
    );
  } catch (error) {
    // A deadline that passed while `consume` ran is not thrown by `consume`; it is its failure too.
    // Once the deadline has fired, it is the batch's error: a consume that rejects later, while the
    // rollback is in flight, must not replace it.
    const seen = atExpiry ?? progress;
    const failure =
      atExpiry !== undefined
        ? atExpiry.consuming.length > 0
          ? { error }
          : undefined
        : (progress.failure ?? (seen.consuming.length > 0 ? { error } : undefined));
    return failure === undefined
      ? { kind: 'failed', error, events: [], read: 0, readTo: null }
      : {
          kind: 'failed',
          error: failure.error,
          events: seen.consuming,
          read: seen.read,
          readTo: seen.readTo,
        };
  }
}
