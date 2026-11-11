import { openStoredEvents } from '../encryption/open-stored-events.ts';
import { errors } from '../errors/errors.ts';
import type { StreamRef } from '../events/stream-ref.ts';
import type { Logger } from '../observability/logger.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import { countReactionFault } from './count-reaction-fault.ts';

/** A fold over more events than this is logged and counted, once per job: the state cache of S-124 is due. */
const longFold = 1000;

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
 * S-124). A fold that passes 1,000 events logs a warning and is counted, once. A stored event whose
 * name the process does not declare is `internal`: the stream holds nothing but what the process
 * wrote.
 */
export async function foldProcessState(
  unit: Unit,
  reaction: ReactionEntry,
  streamId: string,
  subject: string | undefined,
  log?: Logger,
): Promise<FoldedProcess> {
  if (reaction.evolve === undefined) {
    throw errors.internal(`the process "${reaction.id}" has no evolve`);
  }
  const stream: StreamRef = { type: reaction.id, id: streamId };
  let state = reaction.initial;
  let version = 0;
  let lastHash: string | null = null;
  const prefix = `${reaction.id}.`;
  let warned = false;
  for (;;) {
    const stored = await unit.events.readStream(stream, {
      fromVersion: version + 1,
      limit: pageSize,
    });
    if (stored.length === 0) break;
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
    }
    if (version > longFold && !warned) {
      warned = true;
      log?.warn('a process folded a long stream', {
        process: reaction.id,
        events: version,
      });
      countReactionFault('long_fold', reaction.id);
    }
  }
  return { stream, subject, state, version, lastHash };
}
