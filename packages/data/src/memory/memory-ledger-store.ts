import type { ControlLedger, LedgerLookup, LedgerRecord, UnfinishedErasure } from '@keelwerk/core';
import { encodeLedgerRecord, parseLedgerLine } from '@keelwerk/core/ledger';
import { malformedQuery } from '../sql/malformed-query.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';

interface Stored {
  readonly seq: number;
  readonly record: unknown;
}

function slot(seq: number): string {
  return String(seq).padStart(20, '0');
}

/** Lookups one `find` takes, and entries it answers. */
const maxLookups = 500;

/** Whether the record is what the lookup asks for (subjects canonical on both sides). */
function matches(lookup: LedgerLookup, record: LedgerRecord): boolean {
  if ('commandId' in lookup) {
    return (
      record.type === lookup.type &&
      record.tenantId === lookup.tenantId &&
      record.commandId === lookup.commandId &&
      record.subjectId === lookup.subjectId
    );
  }
  if (record.type !== 'keyTombstone') return false;
  return 'keyId' in lookup ? record.keyId === lookup.keyId : record.scopeId === lookup.scopeId;
}

function sameErasure(
  completion: LedgerRecord,
  erasure: Extract<LedgerRecord, { readonly type: 'erasure' }>,
): completion is Extract<LedgerRecord, { readonly type: 'erasureCompleted' }> {
  return (
    completion.type === 'erasureCompleted' &&
    completion.tenantId === erasure.tenantId &&
    completion.commandId === erasure.commandId &&
    completion.subjectId === erasure.subjectId
  );
}

/**
 * `kw_ledger` in the in-memory adapter: the canonical record as JSON beside its seq. The sequence
 * is not transactional, so a rolled-back unit leaves a gap, as the identity column does.
 */
export function memoryLedgerStore(ctx: MemoryUnitContext): ControlLedger {
  const collection = memoryM2Collections.ledger;
  const entriesOf = (): readonly Stored[] =>
    [...ctx.tx.read<Stored>(collection).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, entry]) => entry);
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
      for (const entry of entriesOf()) {
        if (BigInt(entry.seq) <= seq) continue;
        const record = parseLedgerLine(JSON.stringify(entry.record));
        if (record !== undefined) found.push({ seq: BigInt(entry.seq), record });
        if (found.length >= limit) break;
      }
      return found;
    },
    find: async (lookups, page) => {
      if (lookups.length > maxLookups) {
        throw malformedQuery(`a ledger lookup takes at most ${maxLookups} entries`);
      }
      const after = page?.after ?? 0n;
      const limit = Math.min(page?.limit ?? maxLookups, maxLookups);
      const found: { seq: bigint; record: LedgerRecord }[] = [];
      for (const entry of entriesOf()) {
        if (BigInt(entry.seq) <= after) continue;
        const record = parseLedgerLine(JSON.stringify(entry.record));
        if (record === undefined || !lookups.some((lookup) => matches(lookup, record))) continue;
        found.push({ seq: BigInt(entry.seq), record });
        if (found.length >= limit) break;
      }
      return found;
    },
    unfinished: async (query) => {
      const entries: { seq: bigint; record: LedgerRecord }[] = [];
      for (const entry of entriesOf()) {
        const record = parseLedgerLine(JSON.stringify(entry.record));
        if (record !== undefined) entries.push({ seq: BigInt(entry.seq), record });
      }
      const erasures: UnfinishedErasure[] = [];
      for (const { seq, record } of entries) {
        if (record.type !== 'erasure' || seq <= query.after) continue;
        if (query.tenantIds !== undefined && !query.tenantIds.includes(record.tenantId)) continue;
        const later = entries.filter(
          (other) => other.seq > seq && sameErasure(other.record, record),
        );
        const epoch = query.epochs.get(record.tenantId) ?? 0;
        const finished = later.some(
          (other) => other.record.type === 'erasureCompleted' && other.record.epoch === epoch,
        );
        if (finished) continue;
        erasures.push({ seq, record, rerun: later.length > 0 });
        if (erasures.length >= query.limit) break;
      }
      return { erasures, head: entries.at(-1)?.seq ?? 0n };
    },
  };
}
