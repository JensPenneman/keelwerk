import { type EventMeta, eventMetaText } from '@keelwerk/core';

/**
 * The `meta` column of an event as JSON text (15.1.2): the invocation's members as they are, and
 * the decision record in the form the chain hashes, so what is stored, what is hashed and what a
 * quota counts cannot drift apart (`eventMetaText`). `decodeEventMeta` is the inverse.
 */
export function encodeEventMeta(meta: EventMeta): string {
  return eventMetaText(meta);
}
