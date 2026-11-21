import type { NewEvent } from '../events/new-event.ts';
import { transientPurgeTypes } from '../replay/transient-purge-types.ts';
import { eventMetaText } from './event-meta-text.ts';

/**
 * What an event costs under `core.eventBytes` (12.2): the bytes of its data, of its before image
 * and of its meta (the decision record with its `prepare` and `request` members, the sealed input),
 * each as the JSON text the store keeps. Zero for a stream type that the framework purges itself
 * on a fixed rule (`transientPurgeTypes`: the change records of receipts; the retention sweep of
 * `transientRecords` removes them, after P7D at least). Every other record, a transient one of a
 * `history: 'state'` entity included, stays until retention or erasure removes it, so it counts.
 * An adapter charges this for every event a unit appends in a tenant or a backend scope; nothing else decides what an event costs.
 */
export function storedEventBytes(
  streamType: string,
  event: Pick<NewEvent, 'data' | 'before' | 'meta'>,
): bigint {
  if (transientPurgeTypes.includes(streamType)) return 0n;
  const data = BigInt(Buffer.byteLength(JSON.stringify(event.data ?? null)));
  const before =
    event.before === null ? 0n : BigInt(Buffer.byteLength(JSON.stringify(event.before)));
  return data + before + BigInt(Buffer.byteLength(eventMetaText(event.meta)));
}
