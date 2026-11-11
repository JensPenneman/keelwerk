// biome-ignore-all lint/style/useNamingConvention: the keys are the column names of the framework tables
import type { StreamRecordStore } from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { malformedQuery } from './malformed-query.ts';
import { expireStreamRecordsStatement } from './postgres/expire-stream-records-statement.ts';
import { takeSerial } from './postgres/serial-statements.ts';
import { recordOfStreamData } from './record-of-stream-data.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { streamExpiryPolicy } from './stream-expiry-policy.ts';
import { streamRecordData } from './stream-record-data.ts';

/** Rows per insert or delete statement, so the parameter count stays far below the driver's limit. */
const chunk = 1000;

/**
 * The records of declared streams in the unit's scope (14.3.2, 15.1.12), in `kw_stream_records`.
 * `seq` is drawn from the `kw_serials` row of the stream and key, so it rises by one per record in
 * commit order and a rolled-back unit gives its values back; a purge leaves the counter. `at` is
 * the adapter clock's instant, never the database's. `data` is `{"record": …}`.
 */
export function sqlStreamRecordStore(ctx: SqlUnitContext): StreamRecordStore {
  const table = ctx.table('kw_stream_records');
  return {
    append: async (stream, key, records) => {
      ctx.writable();
      if (records.length === 0) throw malformedQuery('a batch of records cannot be empty');
      const data = records.map((record) => streamRecordData(record));
      const at = encodeInstant(ctx.clock.now());
      const db = ctx.scopedDb();
      return sqlGuard(async () => {
        const firstSeq = await takeSerial(
          db,
          {
            table: ctx.table('kw_serials'),
            entity: `stream:${stream}`,
            field: 'seq',
            partition: canonicalizeJson([key]),
          },
          data.length,
        );
        for (let start = 0; start < data.length; start += chunk) {
          await db
            .insertInto(table)
            .values(
              data.slice(start, start + chunk).map((text, offset) => ({
                stream,
                key,
                seq: (firstSeq + BigInt(start + offset)).toString(),
                at,
                data: text,
              })),
            )
            .execute();
        }
        return { firstSeq };
      });
    },
    read: async (stream, key, afterSeq, limit) => {
      if (!Number.isInteger(limit) || limit < 1) {
        throw malformedQuery('limit must be an integer of at least 1');
      }
      const db = ctx.scopedDb();
      return sqlGuard(async () => {
        let query = db
          .selectFrom(table)
          .select(['seq', 'at', 'data'])
          .where('stream', '=', stream)
          .where('key', '=', key);
        if (afterSeq !== null) query = query.where('seq', '>', afterSeq.toString());
        const rows = await query.orderBy('seq', 'asc').limit(limit).execute();
        return rows.map((row) => ({
          seq: BigInt(String(row.seq)),
          at: decodeInstant(row.at),
          data: recordOfStreamData(row.data),
        }));
      });
    },
    expire: async (stream, policy, limit) => {
      ctx.writable();
      const scopeId = ctx.scopeId();
      const { maxAgeMs, maxPerKey } = streamExpiryPolicy(policy, limit);
      const before =
        maxAgeMs === null
          ? null
          : encodeInstant(
              Temporal.Instant.fromEpochMilliseconds(ctx.clock.now().epochMilliseconds - maxAgeMs),
            );
      return sqlGuard(async () => {
        const removed = await runSql(
          ctx.db,
          expireStreamRecordsStatement(ctx.namespace.root, {
            scopeId,
            stream,
            before,
            maxPerKey,
            limit,
          }),
        );
        return removed.length;
      });
    },
    purgeKeys: async (stream, keys) => {
      ctx.writable();
      const db = ctx.scopedDb();
      let removed = 0;
      for (let start = 0; start < keys.length; start += chunk) {
        const batch = keys.slice(start, start + chunk);
        const result = await sqlGuard(async () =>
          db
            .deleteFrom(table)
            .where('stream', '=', stream)
            .where('key', 'in', batch)
            .executeTakeFirst(),
        );
        removed += Number(result?.numDeletedRows ?? 0n);
      }
      return removed;
    },
  };
}
