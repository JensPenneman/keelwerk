import type { LedgerRecord } from '../kernel/ledger-record.ts';
import type { RuntimeServiceContext } from './runtime-service-context.ts';

const pageSize = 500;

/** What replaying the ledger union reads: the control store's ledger and every sink. */
export type ReplayContext = Pick<RuntimeServiceContext, 'control' | 'ledgers'>;

/** What a replay offers beside the records it yields. */
export interface ReplayOptions {
  /**
   * Sees every entry of the control store's ledger, in ledger order, whatever `pick` makes of it, so
   * a caller that needs more of the ledger (completions, tombstones, the head) takes it from the
   * same read and never reads the ledger twice.
   */
  readonly observe?: (entry: { readonly seq: bigint; readonly record: LedgerRecord }) => void;
  /**
   * Called with the failure of a sink that cannot be read; the sink is then left out and the replay
   * goes on. Without it the failure ends the replay.
   */
  readonly onSinkError?: (cause: unknown) => void;
}

/**
 * The records `pick` accepts, from the control store's ledger (pages of 500) and then from every
 * ledger sink (14.7.6), each `key` once (the first record seen wins), in ledger order and then in
 * sink order. The sinks are outside the placement and its backups, so a record the control copy lost
 * to a restore is still found. `options` adds an observer of the control entries and the
 * tolerance of a sink that cannot be read.
 */
export async function* replayLedgerRecords<T>(
  context: ReplayContext,
  pick: (record: LedgerRecord) => T | undefined,
  key: (record: T) => string,
  options: ReplayOptions = {},
): AsyncGenerator<T, void, undefined> {
  const seen = new Set<string>();
  let after = 0n;
  for (;;) {
    const page = await context.control.ledger.since(after, pageSize);
    if (page.length === 0) break;
    for (const entry of page) {
      after = entry.seq;
      options.observe?.(entry);
      const record = pick(entry.record);
      if (record === undefined || seen.has(key(record))) continue;
      seen.add(key(record));
      yield record;
    }
  }
  for (const sink of context.ledgers) {
    try {
      for await (const stored of sink.read()) {
        const record = pick(stored);
        if (record === undefined || seen.has(key(record))) continue;
        seen.add(key(record));
        yield record;
      }
    } catch (cause) {
      if (options.onSinkError === undefined) throw cause;
      options.onSinkError(cause);
    }
  }
}
