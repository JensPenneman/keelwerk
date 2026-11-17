import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import type { StoredEvent } from '../events/stored-event.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import type { ProcessStateRecord } from './process-state-record.ts';

/**
 * The state a cache record holds, when the record is still true of the stream: `head` is the event
 * the stream holds at the record's version, and it must be that very event (the same version and the
 * same stored hash). A process without a data subject keeps its state as JSON text; a process with
 * one keeps that text sealed under the subject's key, which must open for this stream and this
 * event. The text is parsed back, which gives the state with its members in the order the fold
 * built them. A record of the other form, a stream that is shorter than the record or holds another
 * event there, a key that is shredded and a text that does not parse are each "no cache":
 * `undefined`, so the caller folds the whole stream. Never throws for the record's content.
 */
export async function usableProcessState(
  unit: Unit,
  reaction: ReactionEntry,
  streamId: string,
  record: ProcessStateRecord,
  head: StoredEvent | undefined,
): Promise<{ readonly state: unknown } | undefined> {
  if (head === undefined || head.version !== record.version) return undefined;
  if ((head.hash ?? null) !== record.hash) return undefined;
  let text: string | undefined;
  if (reaction.dataSubject !== 'instanceKey') {
    if (record.sealed === undefined) text = record.text;
  } else if (record.sealed !== undefined) {
    text = await personalSealerOf(unit)?.openProcessState({
      streamId,
      eventId: head.eventId,
      sealed: record.sealed,
    });
  }
  if (text === undefined) return undefined;
  try {
    return { state: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}
