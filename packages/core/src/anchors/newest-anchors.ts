import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';

/** An anchor record. */
export type AnchorRecord = Extract<LedgerRecord, { readonly type: 'anchor' }>;

/** The anchor of the highest position per scope across every sink; sinks that cannot be read are an error for the caller to handle. */
export async function newestAnchors(
  sinks: readonly LedgerSink[],
): Promise<ReadonlyMap<string, AnchorRecord>> {
  const newest = new Map<string, { record: AnchorRecord; position: bigint }>();
  for (const sink of sinks) {
    for await (const record of sink.read()) {
      if (record.type !== 'anchor') continue;
      const position = BigInt(record.position);
      const known = newest.get(record.scopeId);
      if (known === undefined || position > known.position)
        newest.set(record.scopeId, { record, position });
    }
  }
  return new Map([...newest].map(([scopeId, entry]) => [scopeId, entry.record]));
}
