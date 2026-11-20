import type { DataAdapter } from '@keelwerk/core';
import { type DumpQuery, dumpDatabase } from '@keelwerk/testing';

/** A query over the owner connection of a PGlite adapter. */
function ownerQuery(adapter: DataAdapter): DumpQuery {
  const owner = adapter as unknown as {
    asOwner<T>(
      fn: (database: {
        query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  return (sql) => owner.asOwner(async (database) => (await database.query(sql)).rows);
}

const receiptTable = 'core__command_receipt';

/** The same query without the receipt table and without the records of stream type `core.commandReceipt`. */
function withoutReceipts(query: DumpQuery): DumpQuery {
  return async (sql) => {
    const rows = await query(
      sql.includes('from pg_stats')
        ? sql.replace('order by 1', `and tablename <> '${receiptTable}' order by 1`)
        : sql,
    );
    return rows.filter(
      (row) =>
        row.tablename !== receiptTable && !JSON.stringify(row).includes('core.commandReceipt'),
    );
  };
}

/** The text of the data store and the control store of a PGlite runtime, receipts included. */
export async function auditDump(
  stores: readonly DataAdapter[],
  options: { readonly receipts: boolean },
): Promise<string> {
  const dumps = await Promise.all(
    stores.map((store) => {
      const query = ownerQuery(store);
      return dumpDatabase(options.receipts ? query : withoutReceipts(query));
    }),
  );
  return dumps.join('\n');
}
