import type { SchemaOperations } from '@keelwerk/core';
import { commandReceiptDdl } from './command-receipt-ddl.ts';
import { commandReceiptTable } from './command-receipt-table.ts';
import { effectRecordDdl } from './effect-record-ddl.ts';
import { effectRecordTable } from './effect-record-table.ts';
import { namespaceLock } from './namespace-lock.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import type { SchemaConnection } from './schema-connection.ts';

/**
 * Provisioning that also creates the `core__command_receipt` and `core__effect` tables of a
 * namespace when the snapshots did not (15.1.7, 7.9.6): the receipt store and the effect records
 * are read and written in every namespace, the control root included. It runs under the namespace
 * lock after the provision it follows, creates each table only when it is absent, and grants the
 * application role the data changes it needs.
 */
export function withCommandReceipts(
  schema: SchemaOperations,
  connection: SchemaConnection,
  role: string | undefined,
): SchemaOperations {
  return {
    ...schema,
    provision: async (namespace, snapshots, options) => {
      await schema.provision(namespace, snapshots, options);
      await connection.transaction(async (session) => {
        const lock = namespaceLock(namespace.root, 'apply');
        await session.query(lock.sql, lock.parameters);
        const tables = [
          { table: commandReceiptTable, ddl: commandReceiptDdl },
          { table: effectRecordTable, ddl: effectRecordDdl },
        ];
        for (const { table, ddl } of tables) {
          const qualified = `"${namespace.root}".${table}`;
          const present = await session.query('select to_regclass($1) as found', [qualified]);
          if (present.rows[0]?.found != null) continue;
          for (const statement of ddl(namespace.root)) await session.query(statement);
          if (role !== undefined) {
            await session.query(
              `grant select, insert, update, delete on ${qualified} to ${quoteIdentifier(role)}`,
            );
          }
        }
      });
    },
  };
}
