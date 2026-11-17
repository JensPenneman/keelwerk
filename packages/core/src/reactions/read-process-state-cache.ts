import type { Unit } from '../storage/unit.ts';
import type { ProcessStateRecord } from './process-state-record.ts';
import { processStateRecordOf } from './process-state-record-of.ts';
import { processStateStream } from './process-state-stream.ts';

/** How many records of one instance are read: normally one, two after a race of workers. */
const readLimit = 4;

/**
 * The valid record of the highest version among the first 4 records of the instance's key in
 * `processStateStream`, or `undefined`. A record built from another `from`, or malformed, is
 * skipped. Whether the record is still true of the stream is the caller's to check against the
 * event at its version. A store error propagates; the content of a record never throws.
 */
export async function readProcessStateCache(
  unit: Unit,
  streamId: string,
  from: string,
): Promise<ProcessStateRecord | undefined> {
  const stored = await unit.streams.read(processStateStream, streamId, null, readLimit);
  let best: ProcessStateRecord | undefined;
  for (const entry of stored) {
    const record = processStateRecordOf(entry.data, from);
    if (record !== undefined && (best === undefined || record.version >= best.version)) {
      best = record;
    }
  }
  return best;
}
