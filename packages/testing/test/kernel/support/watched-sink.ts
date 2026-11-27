import type { LedgerRecord, LedgerSink } from '@keelwerk/core';

/** A ledger sink that keeps what it took and runs `watch` with each batch before it takes it. */
export function watchedSink(
  watch: (records: readonly LedgerRecord[]) => Promise<void>,
): LedgerSink {
  const taken: LedgerRecord[] = [];
  return {
    id: 'watched',
    append: async (records) => {
      await watch(records);
      taken.push(...records);
    },
    read: async function* () {
      yield* taken;
    },
  };
}
