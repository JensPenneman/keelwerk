import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The erasure records after `after` that have no completion of the same identity (tenant, command
 * id, subject) after them at the tenant's epoch, in seq order. `epochs` is the object of tenant id
 * to epoch (a tenant it lacks is at 0). `rerun` is true when a completion of the identity stands
 * after the record at another epoch. One statement: two correlated subqueries over the indexes of
 * step 0003.
 */
export function ledgerUnfinishedStatement(
  rootName: string,
  query: {
    readonly epochs: Readonly<Record<string, number>>;
    readonly after: bigint;
    readonly limit: number;
    readonly tenantIds?: readonly string[];
  },
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const same = `c.type = 'erasureCompleted' and c.record->>'tenantId' = e.record->>'tenantId' and c.record->>'commandId' = e.record->>'commandId' and c.record->>'subjectId' = e.record->>'subjectId' and c.seq > e.seq`;
  return {
    sql: `select e.seq::text as seq, e.record, exists (select 1 from ${root}.kw_ledger c where ${same}) as rerun from ${root}.kw_ledger e where e.type = 'erasure' and e.seq > $1::bigint and ($3::jsonb is null or e.record->>'tenantId' in (select jsonb_array_elements_text($3::jsonb))) and not exists (select 1 from ${root}.kw_ledger c where ${same} and (c.record->>'epoch')::int = coalesce(($4::jsonb ->> (e.record->>'tenantId'))::int, 0)) order by e.seq limit $2::int`,
    parameters: [
      query.after.toString(),
      query.limit,
      query.tenantIds === undefined ? null : JSON.stringify([...query.tenantIds]),
      JSON.stringify(query.epochs),
    ],
  };
}
