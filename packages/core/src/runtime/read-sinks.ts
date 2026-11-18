import type { AnchorRecord } from '../anchors/newest-anchors.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import { replayedKeyOf } from './replayed-key-of.ts';
import type { ReplayedRecord } from './replayed-record.ts';

/**
 * Reads every ledger sink once, in one pass, for the restore check: the anchor of the highest
 * position per scope (what `newestAnchors` answers) and the erasure and key tombstone records the
 * ledger replay reconciles, each distinct record once however many sinks hold it. A sink that
 * cannot be read rejects: neither the anchors nor the records may be judged from part of the sinks,
 * so the start fails.
 */
export async function readSinks(sinks: readonly LedgerSink[]): Promise<{
  readonly anchors: ReadonlyMap<string, AnchorRecord>;
  readonly records: readonly ReplayedRecord[];
}> {
  const newest = new Map<string, { record: AnchorRecord; position: bigint }>();
  const seen = new Map<string, ReplayedRecord>();
  for (const sink of sinks) {
    for await (const record of sink.read()) {
      if (record.type === 'anchor') {
        const position = BigInt(record.position);
        const known = newest.get(record.scopeId);
        if (known === undefined || position > known.position) {
          newest.set(record.scopeId, { record, position });
        }
      } else if (record.type === 'erasure' || record.type === 'keyTombstone') {
        const key = replayedKeyOf(record);
        if (key !== undefined && !seen.has(key)) seen.set(key, record);
      }
    }
  }
  return {
    anchors: new Map([...newest].map(([scopeId, entry]) => [scopeId, entry.record])),
    records: [...seen.values()],
  };
}
