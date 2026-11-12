import type { ErasureCompletedRecord, ErasureRecord, LedgerRecord } from '@keelwerk/core';
import { erasureKey } from '@keelwerk/core';

/** The completions that count, by erasure (`erasureKey`: tenant, command id and canonical subject). */
export interface Completions {
  /** Takes the records of the control ledger in ledger order. */
  observe(record: LedgerRecord): void;
  /** The completions that stand after the record of the erasure, in ledger order. */
  of(
    erasure: Pick<ErasureRecord, 'tenantId' | 'commandId' | 'subjectId'>,
  ): readonly ErasureCompletedRecord[];
}

/**
 * Collects completions as the records of the control ledger go by. A completion counts for an
 * erasure only when it stands AFTER that erasure's record in the ledger: ledger order, never clock
 * time, so a completion left over from before a restore, or one that is not the record's own
 * (another tenant, another command id, another subject), never finishes an erasure. A record that is
 * observed again (a pass reads the ledger from its start) is kept once.
 */
export function createCompletions(): Completions {
  const recorded = new Set<string>();
  const found = new Map<string, ErasureCompletedRecord[]>();
  return {
    observe: (record) => {
      if (record.type === 'erasure') {
        recorded.add(erasureKey(record));
      } else if (record.type === 'erasureCompleted') {
        const key = erasureKey(record);
        if (!recorded.has(key)) return;
        const stored = found.get(key) ?? [];
        const again = stored.some(
          (other) => other.epoch === record.epoch && other.recordedAt === record.recordedAt,
        );
        if (!again) found.set(key, [...stored, record]);
      }
    },
    of: (erasure) => found.get(erasureKey(erasure)) ?? [],
  };
}
