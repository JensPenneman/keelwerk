import { personalSealerOf } from '../encryption/personal-sealer-of.ts';
import { plainJsonProblem } from '../flags/plain-json-problem.ts';
import type { ReactionEntry } from '../registry/reaction-entry.ts';
import type { Unit } from '../storage/unit.ts';
import type { ProcessStateRecord } from './process-state-record.ts';
import { writeProcessStateCache } from './write-process-state-cache.ts';

/**
 * Writes the cache of a state folded to `head` (S-124), unless it cannot be kept: a state that is no
 * plain JSON (so that it would not read back as it is), and, for a process with a data subject, a
 * subject whose key is gone. A process without a data subject keeps its state as JSON text: its
 * stream seals nothing, so the cache holds nothing the stream does not, and a text keeps the order
 * of the state's members, which a `jsonb` value would not. A process with a data subject keeps only
 * the sealed JSON text. Answers whether a record was written.
 */
export async function refreshProcessStateCache(
  unit: Unit,
  reaction: ReactionEntry,
  input: {
    readonly streamId: string;
    readonly subject: string | undefined;
    readonly from: string;
    readonly state: unknown;
    readonly head: {
      readonly version: number;
      readonly hash: string | null;
      readonly eventId: string;
    };
  },
): Promise<boolean> {
  const { streamId, from, state, head } = input;
  if (plainJsonProblem(state, 0, true) !== undefined) return false;
  const base = { v: 1, from, version: head.version, hash: head.hash } as const;
  let record: ProcessStateRecord;
  if (reaction.dataSubject === 'instanceKey') {
    const sealer = personalSealerOf(unit);
    if (sealer === undefined || input.subject === undefined) return false;
    const sealed = await sealer.sealProcessState({
      streamId,
      eventId: head.eventId,
      subject: input.subject,
      state: JSON.stringify(state),
    });
    if (sealed === null) return false;
    record = { ...base, sealed };
  } else {
    record = { ...base, text: JSON.stringify(state) };
  }
  await writeProcessStateCache(unit, streamId, record);
  return true;
}
