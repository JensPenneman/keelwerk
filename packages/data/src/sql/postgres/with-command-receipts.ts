import type { SchemaOperations } from '@keelwerk/core';
import { commandReceiptDdl } from './command-receipt-ddl.ts';
import { commandReceiptTable } from './command-receipt-table.ts';
import { namespaceLock } from './namespace-lock.ts';
import { quoteIdentifier } from './quote-identifier.ts';
import type { SchemaConnection } from './schema-connection.ts';

/**
 * Provisioning that also creates the `core__command_receipt` table of a namespace when the
 * snapshots did not (15.1.7): the receipt store reads and writes it in every namespace, the
 * control root included. It runs under the namespace lock after the provision it follows, is a
 * no-op once the table exists, and grants the application role the data changes it needs.
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
        const table = `"${namespace.root}".${commandReceiptTable}`;
        const present = await session.query('select to_regclass($1) as found', [table]);
        if (present.rows[0]?.found != null) return;
        for (const statement of commandReceiptDdl(namespace.root)) await session.query(statement);
        if (role !== undefined) {
          await session.query(
            `grant select, insert, update, delete on ${table} to ${quoteIdentifier(role)}`,
          );
        }
      });
    },
  };
}
