import { openKwe } from '../keys/open-kwe.ts';
import type { StreamRecord } from '../storage/stream-record.ts';
import { isKweEnvelope } from './is-kwe-envelope.ts';
import type { SealingContext } from './sealing-context.ts';

const decoder = new TextDecoder();

/** What opening the records of one key reads. */
export interface OpenStreamRecordsInput {
  readonly stream: string;
  readonly key: string;
  /** The members the stream declares personal (`streamPersonalMembers`); no other member is opened. */
  readonly personal: readonly string[];
  readonly records: readonly StreamRecord[];
}

/**
 * Opens the `$kwe` members of stored records that the stream declares personal with the binding they were sealed under
 * (`namespace ‖ stream ‖ key ‖ member`). A member that does not open (a shredded key, a value
 * moved to another key or member) is left out; any other member is returned as stored, even one shaped like an envelope, so it reads as absent (14.7.9.8).
 */
export async function openStreamRecords(
  context: SealingContext,
  input: OpenStreamRecordsInput,
): Promise<readonly StreamRecord[]> {
  const personal = new Set(input.personal);
  const opened: StreamRecord[] = [];
  for (const stored of input.records) {
    const { data } = stored;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      opened.push(stored);
      continue;
    }
    const out: Record<string, unknown> = {};
    for (const [member, value] of Object.entries(data)) {
      if (!personal.has(member) || !isKweEnvelope(value)) {
        out[member] = value;
        continue;
      }
      const key = await context.keyById(value.k);
      const plain = openKwe(value, key?.material, {
        namespace: context.unit.namespace.id,
        streamId: input.stream,
        eventId: input.key,
        field: member,
      });
      if (plain !== undefined) out[member] = JSON.parse(decoder.decode(plain)) as unknown;
    }
    opened.push({ ...stored, data: out });
  }
  return opened;
}
