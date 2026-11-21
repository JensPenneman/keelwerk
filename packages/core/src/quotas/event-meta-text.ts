import { encodeDecisionRecord } from '../events/encode-decision-record.ts';
import type { EventMeta } from '../events/event-meta.ts';

/**
 * The JSON text of an event's meta as `kw_events.meta` keeps it (15.1.2): the invocation's members
 * as they are and the decision record in the form the chain hashes.
 */
export function eventMetaText(meta: EventMeta): string {
  return JSON.stringify({
    ...meta,
    decision: meta.decision === null ? null : encodeDecisionRecord(meta.decision),
  });
}
