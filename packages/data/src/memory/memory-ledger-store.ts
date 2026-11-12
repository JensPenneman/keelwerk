import type { ControlLedger, LedgerRecord } from '@keelwerk/core';
import { encodeLedgerRecord, parseLedgerLine } from '@keelwerk/core/ledger';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface Stored {
  readonly seq: number;
  readonly record: unknown;
}

function slot(seq: number): string {
  return String(seq).padStart(20, '0');
}

/**
 * `kw_ledger` in the in-memory adapter: the canonical record as JSON beside its seq. The sequence
 * is not transactional, so a rolled-back unit leaves a gap, as the identity column does.
 */
export function memoryLedgerStore(ctx: MemoryUnitContext): ControlLedger {
  const collection = memoryM2Collections.ledger;
  return {
    append: async (record) => {
      ctx.writable();
      ctx.state.sequences.ledger += 1;
      const seq = ctx.state.sequences.ledger;
      const stored: Stored = {
        seq,
        record: JSON.parse(encodeLedgerRecord(record)) as unknown,
      };
      ctx.tx.write<Stored>(collection).set(slot(seq), stored);
      return BigInt(seq);
    },
    since: async (seq, limit) => {
      const found: { seq: bigint; record: LedgerRecord }[] = [];
      const entries = [...ctx.tx.read<Stored>(collection).entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      for (const [, entry] of entries) {
        if (BigInt(entry.seq) <= seq) continue;
        const record = parseLedgerLine(JSON.stringify(entry.record));
        if (record !== undefined) found.push({ seq: BigInt(entry.seq), record });
        if (found.length >= limit) break;
      }
      return found;
    },
  };
}
