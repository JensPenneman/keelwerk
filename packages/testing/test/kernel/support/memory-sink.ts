import type { LedgerRecord, LedgerSink } from '@keelwerk/core';

/** An append-only log outside the placement: it survives a restore of the database, as a real sink does. */
export function memorySink(): LedgerSink & { readonly records: LedgerRecord[] } {
  const records: LedgerRecord[] = [];
  return {
    id: 'memory',
    records,
    append: async (batch) => {
      records.push(...batch);
    },
    read: async function* () {
      yield* records;
    },
  };
}
