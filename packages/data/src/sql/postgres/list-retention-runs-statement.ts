import type { PostgresStatement } from './begin-unit-statements.ts';
import { quoteIdentifier } from './quote-identifier.ts';

/**
 * The newest runs of one scope of `kw_retention_runs`, as one of two statements, so that each
 * matches the index `kw_retention_runs_scope (backend_id, tenant_id, started_at)`: `tenant_id = $2`
 * for a tenant, `tenant_id is null` for a scope that is not one. `columns` is the select list.
 */
export function listRetentionRunsStatement(
  root: string,
  columns: string,
  query: { readonly backendId: string; readonly tenantId: string | null; readonly limit: number },
): PostgresStatement {
  const table = `${quoteIdentifier(root)}.kw_retention_runs`;
  const order = 'order by started_at desc, run_id desc';
  return query.tenantId === null
    ? {
        sql: `select ${columns} from ${table}
where backend_id = $1::uuid and tenant_id is null
${order} limit $2::int`,
        parameters: [query.backendId, query.limit],
      }
    : {
        sql: `select ${columns} from ${table}
where backend_id = $1::uuid and tenant_id = $2::uuid
${order} limit $3::int`,
        parameters: [query.backendId, query.tenantId, query.limit],
      };
}
