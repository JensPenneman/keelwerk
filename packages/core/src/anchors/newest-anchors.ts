import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { LedgerSink } from '../kernel/ledger-sink.ts';
import { readSinks } from '../runtime/read-sinks.ts';

/** An anchor record. */
export type AnchorRecord = Extract<LedgerRecord, { readonly type: 'anchor' }>;

/** The anchor of the highest position per scope across every sink; sinks that cannot be read are an error for the caller to handle. */
export async function newestAnchors(
  sinks: readonly LedgerSink[],
): Promise<ReadonlyMap<string, AnchorRecord>> {
  return (await readSinks(sinks)).anchors;
}
