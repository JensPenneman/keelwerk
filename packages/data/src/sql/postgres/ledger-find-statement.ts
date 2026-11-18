import type { LedgerLookup } from '@keelwerk/core';
import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The entries of `kw_ledger` that match any lookup, after `after`, in seq order (framework step
 * 0003's indexes answer each branch): a lookup is one `or` branch with the record type as a literal,
 * so the planner can prove the partial index's predicate, and its values as parameters.
 */
export function ledgerFindStatement(
  rootName: string,
  lookups: readonly LedgerLookup[],
  page: { readonly after: bigint; readonly limit: number },
): PostgresStatement {
  const root = quoteIdentifier(rootName);
  const parameters: unknown[] = [page.after.toString(), page.limit];
  const next = (value: string): string => {
    parameters.push(value);
    return `$${parameters.length}::text`;
  };
  const branches = lookups.map((lookup) => {
    if ('commandId' in lookup) {
      const type = lookup.type === 'erasure' ? 'erasure' : 'erasureCompleted';
      return `(type = '${type}' and record->>'tenantId' = ${next(lookup.tenantId)} and record->>'commandId' = ${next(lookup.commandId)} and record->>'subjectId' = ${next(lookup.subjectId)})`;
    }
    if ('keyId' in lookup) {
      return `(type = 'keyTombstone' and record->>'keyId' = ${next(lookup.keyId)})`;
    }
    return `(type = 'keyTombstone' and record->>'scopeId' = ${next(lookup.scopeId)})`;
  });
  return {
    sql: `select seq::text as seq, record from ${root}.kw_ledger where seq > $1::bigint and (${branches.length === 0 ? 'false' : branches.join(' or ')}) order by seq limit $2::int`,
    parameters,
  };
}
