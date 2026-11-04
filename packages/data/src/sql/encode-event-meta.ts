import { type EventMeta, encodeDecisionRecord } from '@keelwerk/core';

/**
 * The `meta` column of an event as JSON text (15.1.2): the invocation's members as they are, and
 * the decision record in the form the chain hashes (`encodeDecisionRecord`), so what is stored
 * and what is hashed cannot drift apart. `decodeEventMeta` is the inverse.
 */
export function encodeEventMeta(meta: EventMeta): string {
  return JSON.stringify({
    ...meta,
    decision: meta.decision === null ? null : encodeDecisionRecord(meta.decision),
  });
}
