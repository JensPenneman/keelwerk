import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * Calls `kw_purge_transient` of the root (framework step 0004), which deletes the committed
 * transient records of the unit's own scope recorded before `before`, of the listed stream types,
 * at most `limit`, and answers how many it deleted (`removed`), the `[data, before, meta]` of each as JSON text
 * (`records`) and whether a candidate is left (`more`, read after the delete).
 * The scope is the one the unit's settings name; the function repeats the scope predicate of the
 * row-level security policies and keeps each stream's newest record (but that of a receipt stream
 * whose receipt row is gone), every record that carries a hash or a previous hash and every other
 * scope's. The function itself refuses a list with any type but `core.commandReceipt` (42501).
 */
export function purgeTransientStatement(
  rootName: string,
  input: {
    readonly before: string;
    readonly limit: number;
    readonly streamTypes: readonly string[];
  },
): PostgresStatement {
  return {
    sql: `select removed, more, records::text as records from ${quoteIdentifier(rootName)}.kw_purge_transient($1::timestamptz, $2::integer, $3::text[])`,
    parameters: [input.before, input.limit, input.streamTypes],
  };
}
