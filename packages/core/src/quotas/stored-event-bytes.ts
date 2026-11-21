import type { NewEvent } from '../events/new-event.ts';
import { eventMetaText } from './event-meta-text.ts';

/**
 * What an event costs under `core.eventBytes` (12.2): the bytes of its data, of its before image
 * and of its meta (the decision record with its `prepare` and `request` members, the sealed input),
 * each as the JSON text the store keeps. Every event counts. The only events that are ever removed
 * are the change records of receipts (the stream type `core.commandReceipt`, `transientPurgeTypes`):
 * the retention sweep's `purgeTransient` deletes them, and the adapter gives their bytes back in
 * the same unit, measured again with this function over the decoded columns of what it deleted (the
 * SQL adapters) or with `storedEventBytesOf` over the stored envelope (the memory adapter). Every
 * other event stays for good: the records of a `history: 'state'` entity (a re-decide folds them),
 * of entities, of processes and of `core.effect`; erasure seals what they hold and keeps the event,
 * and nothing gives their bytes back. An adapter charges this for every event a unit appends in a
 * tenant or a backend scope; nothing else decides what an event costs.
 */
export function storedEventBytes(event: Pick<NewEvent, 'data' | 'before' | 'meta'>): bigint {
  const data = BigInt(Buffer.byteLength(JSON.stringify(event.data ?? null)));
  const before =
    event.before === null ? 0n : BigInt(Buffer.byteLength(JSON.stringify(event.before)));
  return data + before + BigInt(Buffer.byteLength(eventMetaText(event.meta)));
}
