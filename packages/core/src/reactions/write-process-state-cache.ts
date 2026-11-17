import type { Unit } from '../storage/unit.ts';
import type { ProcessStateRecord } from './process-state-record.ts';
import { processStateStream } from './process-state-stream.ts';

/**
 * Replaces the instance's cache in `unit`: the records of its key are purged, then the one record is
 * appended. The write belongs to the unit of the job that folded the state, so a job that rolls back
 * leaves no cache of its own behind.
 */
export async function writeProcessStateCache(
  unit: Unit,
  streamId: string,
  record: ProcessStateRecord,
): Promise<void> {
  await unit.streams.purgeKeys(processStateStream, [streamId]);
  await unit.streams.append(processStateStream, streamId, [record]);
}
