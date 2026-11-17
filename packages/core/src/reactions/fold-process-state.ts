import { openStoredEvents } from '../encryption/open-stored-events.ts';
import { errors } from '../errors/errors.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { Logger } from '../observability/logger.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { countReactionFault } from './count-reaction-fault.ts';
import { processStateFrom } from './process-state-from.ts';
import { readProcessStateCache } from './read-process-state-cache.ts';
import { refreshProcessStateCache } from './refresh-process-state-cache.ts';
import { usableProcessState } from './usable-process-state.ts';

/** A fold over more events than this is logged and counted, once per job: the state cache of S-124 should have kept it short. */
const longFold = 1000;

/** A fold that read at least this many events past its base writes the instance's cache again. */
const refreshAfter = 32;

/** How many events one read of the stream takes. */
const pageSize = 500;

/** The state of one process instance, folded from its stream. */
export interface FoldedProcess {
  readonly stream: StreamRef;
  /**
   * The instance's data subject, the instance key a process that declares one seals its personal
   * members for (`openProcessSubject`); undefined for a process that has none.
   */
  readonly subject: string | undefined;
  readonly state: unknown;
  /** The version of the stream's last event; 0 when it has none yet. */
  readonly version: number;
  /** The hash of the last event: the next event chains onto it; null with no event yet. */
  readonly lastHash: string | null;
}

/**
 * Reads the instance's stream `streamId` (the one the job names: the dispatcher derived it from the
 * instance key, which is never computed again here) in `unit`, opens its personal values (a value
 * whose key is shredded is absent) and folds the process's `evolve` over it from `initial` (7.7,
 * S-124). A stored event whose name the process does not declare is `internal`: the stream holds
 * nothing but what the process wrote.
 *
 * With a `build` the fold uses the instance's state cache (S-124): the cached state of version `n`
 * is used when the stream holds the very event the cache names at `n` (same version and hash) and,
 * for a process with a data subject, the sealed state opens; the fold then reads the stream from
 * `n`, one page when nothing is newer, and applies only the later events. The cache is derived
 * data: one that is missing, older, of another build or process text, malformed, unopenable (its
 * subject erased) or ahead of the stream is not used, and the fold is the whole stream's, so it
 * decides exactly what a fold without a cache decides. A fold that read at least 32 events past its
 * base writes the cache for the head, in `unit`, unless the unit is read-only or the state is no
 * plain JSON. Without a `build` the cache is neither read nor written. A fold that applies more
 * than 1,000 events logs a warning and is counted, once.
 */
export async function foldProcessState(
  unit: Unit,
  reaction: ReactionEntry,
  streamId: string,
  subject: string | undefined,
  log?: Logger,
  build?: string,
): Promise<FoldedProcess> {
  if (reaction.evolve === undefined) {
    throw errors.internal(`the process "${reaction.id}" has no evolve`);
  }
  const stream: StreamRef = { type: reaction.id, id: streamId };
  const from = build === undefined ? undefined : processStateFrom(reaction, build);
  let state = reaction.initial;
  let version = 0;
  let lastHash: string | null = null;
  let lastEventId: string | undefined;
  let folded = 0;
  const prefix = `${reaction.id}.`;
  let warned = false;
  // A page that is already read, with the number of events the store answered it with.
  let ahead: { readonly events: readonly StoredEvent[]; readonly read: number } | undefined;
  const cached = from === undefined ? undefined : await readProcessStateCache(unit, streamId, from);
  if (cached !== undefined) {
    // The page starts at the cached version: its first event is the one the cache names, checked
    // and not folded again.
    const page = await unit.events.readStream(stream, {
      fromVersion: cached.version,
      limit: pageSize,
    });
    const usable = await usableProcessState(unit, reaction, streamId, cached, page[0]);
    if (usable !== undefined && page[0] !== undefined) {
      state = usable.state;
      version = cached.version;
      lastHash = cached.hash;
      lastEventId = page[0].eventId;
      ahead = { events: page.slice(1), read: page.length };
    }
  }
  for (;;) {
    let stored: readonly StoredEvent[];
    let read: number;
    if (ahead === undefined) {
      stored = await unit.events.readStream(stream, { fromVersion: version + 1, limit: pageSize });
      read = stored.length;
    } else {
      ({ events: stored, read } = ahead);
      ahead = undefined;
    }
    const opened = await openStoredEvents(unit, stored);
    for (const [index, record] of opened.entries()) {
      const name = record.type.startsWith(prefix) ? record.type.slice(prefix.length) : record.type;
      if (!(reaction.events ?? []).includes(name)) {
        throw errors.internal(
          `the stream of the process "${reaction.id}" holds the event "${record.type}", which it does not declare`,
        );
      }
      state = reaction.evolve(state, { type: name, data: record.data, version: record.version });
      version = record.version;
      lastHash = stored[index]?.hash ?? null;
      lastEventId = stored[index]?.eventId;
      folded += 1;
    }
    if (folded > longFold && !warned) {
      warned = true;
      log?.warn('a process folded a long stream', {
        process: reaction.id,
        events: folded,
      });
      countReactionFault('long_fold', reaction.id);
    }
    // A short page is the end of the stream: an instance that is up to date costs one read.
    if (read < pageSize) break;
  }
  if (from !== undefined && folded >= refreshAfter && !unit.readOnly && lastEventId !== undefined) {
    await refreshProcessStateCache(unit, reaction, {
      streamId,
      subject,
      from,
      state,
      head: { version, hash: lastHash, eventId: lastEventId },
    });
  }
  return { stream, subject, state, version, lastHash };
}
