import type {
  ConsumerSpec,
  EventSelector,
  Logger,
  ParkedStream,
  Position,
  ScopeTarget,
  StoredEvent,
  StreamRef,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { lockCheckpoint } from './lock-checkpoint.ts';
import { parkedError } from './parked-error.ts';
import { withinDeadline } from './within-deadline.ts';

/** How one chunk of a replay ended. */
type Chunk =
  | { readonly kind: 'absent' }
  | { readonly kind: 'more' | 'done'; readonly from: Position };

/** The consumer's selector narrowed to one stream; `undefined` when the selector never reaches it. */
function selectorOf(selector: EventSelector, stream: StreamRef): EventSelector | undefined {
  if (
    selector.streams !== undefined &&
    !selector.streams.some((named) => named.type === stream.type && named.id === stream.id)
  ) {
    return undefined;
  }
  return { ...selector, streams: [stream] };
}

/** What a replay is run with. */
export interface UnparkStreamInput {
  readonly spec: ConsumerSpec;
  readonly target: ScopeTarget;
  readonly scopeId: string;
  readonly stream: StreamRef;
  /** Events per `consume` call, and per unit, of the replay. */
  readonly batchSize: number;
  /** A chunk fails when its unit's work has not settled by then (real time). */
  readonly deadlineMs: number;
  /** Receives the late failure of work the deadline abandoned. */
  readonly log: Logger;
  /** Lists the work the deadline abandoned until it settles; the runner's handover reads it. */
  readonly abandoned?: Set<Promise<unknown>>;
  /**
   * Asked between chunks: false once the replay must not go on (the runner stops or lost its lease;
   * renewed when due). The replay then ends with `unavailable`, and the stream stays parked from
   * where it stopped. Default: always true.
   */
  readonly proceed?: () => Promise<boolean>;
}

/**
 * Unparks a stream and replays it in chunks (D5). The stream's events from its parked position up to
 * the checkpoint locked at the chunk go to `consume` in order, `batchSize` at a time; later events
 * follow by the normal batches. Each chunk is one unit under the checkpoint lock. When a chunk is not
 * the last one its unit also moves the parked row's start behind the events it delivered, so a crash
 * or a takeover resumes there and no committed chunk is delivered again; the last chunk removes the
 * row. Between chunks the runner is asked whether to go on. A chunk whose `consume` fails, or whose
 * unit outlasts the deadline, rolls back and leaves the row as it was; a second unit then parks the
 * stream again at the row's start (the parking counts) and the failure is rethrown. Answers the
 * position the stream was parked at when the replay began, or `null` when it was not parked.
 */
export async function unparkStream(input: UnparkStreamInput): Promise<Position | null> {
  const { spec, target, scopeId, stream, batchSize, deadlineMs, log, abandoned } = input;
  const same = (row: ParkedStream): boolean =>
    row.stream.type === stream.type && row.stream.id === stream.id;
  const chunk = async (): Promise<Chunk> => {
    const progress: {
      row?: ParkedStream;
      consuming: readonly StoredEvent[];
    } = { consuming: [] };
    // What the chunk had done when the deadline fired: `consume` may resolve while the unit rolls
    // back and clear `progress`, which must not hide that the events were in `consume`.
    let atExpiry: { row: ParkedStream | undefined; consuming: readonly StoredEvent[] } | undefined;
    try {
      return await target.handle.adapter.unit(target.namespace, target.scope, (unit) =>
        withinDeadline(
          deadlineMs,
          {
            onLate: (error) => {
              log.warn('work of a replay failed after its deadline and was refused', {
                consumer: spec.id,
                scope: scopeId,
                stream,
                cause: error,
              });
            },
            onExpire: () => {
              atExpiry = { row: progress.row, consuming: progress.consuming };
            },
            ...(abandoned === undefined ? {} : { abandoned }),
          },
          async (expired): Promise<Chunk> => {
            const at = await lockCheckpoint(unit, spec.id, scopeId);
            const row = (await unit.consumers.parked(spec.id)).find(same);
            if (row === undefined) return { kind: 'absent' };
            progress.row = row;
            const selector = selectorOf(spec.selector, stream);
            let last: Position | undefined;
            let more = false;
            if (selector !== undefined && at !== null) {
              const page = await unit.events.readAll(row.from - 1n, {
                limit: batchSize,
                selector,
                includeTransient: true,
              });
              const events = page.events.filter((event) => event.position <= at);
              if (events.length > 0) {
                // A read that was already on its way when the deadline fired comes back late.
                expired();
                progress.consuming = events;
                await spec.consume(events, unit);
                progress.consuming = [];
              }
              last = events.at(-1)?.position;
              more = page.events.length >= batchSize && events.length === page.events.length;
            }
            // A chunk that is not the last moves the row's start on and keeps its attempts, its
            // parking time and its error, so an operator's listing still says how often and since
            // when the stream is parked.
            if (more && last !== undefined) {
              await unit.consumers.advanceParked(spec.id, stream, last + 1n);
            } else await unit.consumers.unpark(spec.id, stream);
            return { kind: more ? 'more' : 'done', from: row.from };
          },
        ),
      );
    } catch (cause) {
      const { row, consuming } = atExpiry ?? progress;
      const failed = consuming[0];
      if (row !== undefined && failed !== undefined) {
        try {
          await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
            await lockCheckpoint(unit, spec.id, scopeId);
            await unit.consumers.park(spec.id, stream, row.from, parkedError(cause, failed));
          });
        } catch (parking) {
          log.warn('a stream could not be parked again after a failed replay', {
            consumer: spec.id,
            scope: scopeId,
            stream,
            cause: parking,
          });
        }
      }
      throw cause;
    }
  };
  let first: Position | null = null;
  for (;;) {
    const result = await chunk();
    if (result.kind === 'absent') return first;
    first ??= result.from;
    if (result.kind === 'done') return first;
    if (input.proceed !== undefined && !(await input.proceed())) {
      throw errors.unavailable(
        'The replay stopped before it ended; the stream stays parked from where it stopped.',
      );
    }
  }
}
