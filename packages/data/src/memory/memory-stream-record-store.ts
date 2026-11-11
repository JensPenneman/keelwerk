import type { StreamRecord, StreamRecordStore } from '@keelwerk/core';
import { malformedQuery } from '../sql/malformed-query.ts';
import { recordOfStreamData } from '../sql/record-of-stream-data.ts';
import { streamExpiryPolicy } from '../sql/stream-expiry-policy.ts';
import { streamRecordData } from '../sql/stream-record-data.ts';
import { floorInstant } from './floor-instant.ts';
import { memoryCloneValue } from './memory-clone-value.ts';
import { memoryM2Collections } from './memory-m2-collections.ts';
import type { MemoryUnitContext } from './memory-unit-context.ts';
import { memoryValueKey } from './memory-value-key.ts';

interface Stored {
  readonly stream: string;
  readonly key: string;
  readonly seq: bigint;
  readonly at: Temporal.Instant;
  /** `{ record }`, the form `kw_stream_records.data` keeps. */
  readonly data: unknown;
}

function entryKey(stream: string, key: string, seq: bigint): string {
  return [stream, key, seq.toString().padStart(20, '0')].join('\u0000');
}

function checkLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw malformedQuery('limit must be an integer of at least 1');
  }
}

/**
 * The records of declared streams in the unit's scope (14.3.2, 15.1.12): each stream and key has
 * a counter in `serials/<scope>` under the same key the SQL adapters use, so seqs rise by one per
 * record, are never reused after a purge and are given back when the unit rolls back. Records
 * keep the `{ record }` envelope of the SQL table, and their instant is the adapter clock's.
 */
export function memoryStreamRecordStore(ctx: MemoryUnitContext): StreamRecordStore {
  const recordsOf = (stream: string): Stored[] => {
    const prefix = `${stream}\u0000`;
    const found: Stored[] = [];
    for (const [name, value] of ctx.tx.read<Stored>(
      memoryM2Collections.streamRecords(ctx.scopeId()),
    )) {
      if (name.startsWith(prefix)) found.push(value);
    }
    return found;
  };
  return {
    append: async (stream, key, records) => {
      ctx.writable();
      const scopeId = ctx.scopeId();
      if (records.length === 0) throw malformedQuery('a batch of records cannot be empty');
      const data = records.map((record) => JSON.parse(streamRecordData(record)) as unknown);
      const counters = ctx.tx.write<bigint>(`serials/${scopeId}`);
      const counter = [`stream:${stream}`, 'seq', memoryValueKey(key)].join('\u0000');
      const firstSeq = counters.get(counter) ?? 1n;
      counters.set(counter, firstSeq + BigInt(records.length));
      const at = floorInstant(ctx.clock.now());
      const table = ctx.tx.write<Stored>(memoryM2Collections.streamRecords(scopeId));
      for (const [index, item] of data.entries()) {
        const seq = firstSeq + BigInt(index);
        table.set(entryKey(stream, key, seq), { stream, key, seq, at, data: item });
      }
      return { firstSeq };
    },
    read: async (stream, key, afterSeq, limit) => {
      checkLimit(limit);
      return recordsOf(stream)
        .filter((stored) => stored.key === key && (afterSeq === null || stored.seq > afterSeq))
        .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
        .slice(0, limit)
        .map(
          (stored): StreamRecord => ({
            seq: stored.seq,
            at: stored.at,
            data: memoryCloneValue(recordOfStreamData(stored.data)),
          }),
        );
    },
    expire: async (stream, policy, limit) => {
      ctx.writable();
      const scopeId = ctx.scopeId();
      const { maxAgeMs, maxPerKey } = streamExpiryPolicy(policy, limit);
      const before = maxAgeMs === null ? null : ctx.clock.now().epochMilliseconds - maxAgeMs;
      const all = recordsOf(stream);
      const rank = new Map<string, number>();
      if (maxPerKey !== null) {
        const byKey = new Map<string, Stored[]>();
        for (const stored of all) {
          const group = byKey.get(stored.key) ?? [];
          group.push(stored);
          byKey.set(stored.key, group);
        }
        for (const group of byKey.values()) {
          group.sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0));
          for (const [index, stored] of group.entries()) {
            rank.set(entryKey(stored.stream, stored.key, stored.seq), index + 1);
          }
        }
      }
      const doomed = all
        .filter(
          (stored) =>
            (before !== null && stored.at.epochMilliseconds < before) ||
            (maxPerKey !== null &&
              (rank.get(entryKey(stored.stream, stored.key, stored.seq)) ?? 0) > maxPerKey),
        )
        .sort(
          (a, b) =>
            a.at.epochMilliseconds - b.at.epochMilliseconds ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
            (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0),
        )
        .slice(0, limit);
      if (doomed.length === 0) return 0;
      const table = ctx.tx.write<Stored>(memoryM2Collections.streamRecords(scopeId));
      for (const stored of doomed) table.delete(entryKey(stored.stream, stored.key, stored.seq));
      return doomed.length;
    },
    purgeKeys: async (stream, keys) => {
      ctx.writable();
      const scopeId = ctx.scopeId();
      const wanted = new Set(keys);
      const doomed = recordsOf(stream).filter((stored) => wanted.has(stored.key));
      if (doomed.length === 0) return 0;
      const table = ctx.tx.write<Stored>(memoryM2Collections.streamRecords(scopeId));
      for (const stored of doomed) table.delete(entryKey(stored.stream, stored.key, stored.seq));
      return doomed.length;
    },
  };
}
