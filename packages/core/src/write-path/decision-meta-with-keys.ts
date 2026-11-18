import type { EventMeta } from '../events/event-meta.ts';
import type { DataKey } from '../storage/data-key.ts';
import { decisionDigest } from './decision-digest.ts';

/**
 * `meta` itself when `keys` is empty or the meta holds no decision record; else a copy whose
 * decision record holds `decisionDigest(its input digest, keys)`: an event that seals personal
 * values of its own (the requested event of an effect) rekeys the digest of the decision it joins.
 */
export function decisionMetaWithKeys(meta: EventMeta, keys: readonly DataKey[]): EventMeta {
  if (keys.length === 0 || meta.decision === null) return meta;
  return {
    ...meta,
    decision: { ...meta.decision, inputDigest: decisionDigest(meta.decision.inputDigest, keys) },
  };
}
