import type { RetentionRun, RetentionRunStore } from '@keelwerk/core';
import { decodeInstant } from './decode-instant.ts';
import { encodeInstant } from './encode-instant.ts';
import { malformedQuery } from './malformed-query.ts';
import { listRetentionRunsStatement } from './postgres/list-retention-runs-statement.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import type { SqlRow } from './run-sql.ts';
import { runSql } from './run-sql.ts';
import { sqlGuard } from './sql-guard.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

const greatestLimit = 1000;

const columns =
  'run_id::text as run_id, started_at, ended_at, namespace_id, backend_id::text as backend_id, tenant_id::text as tenant_id, outcome, error, rule, removed, horizons';

/** A jsonb column as the driver returns it: parsed already, or as text. */
function jsonOf<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function runOf(row: SqlRow): RetentionRun {
  return {
    runId: String(row.run_id),
    startedAt: decodeInstant(row.started_at),
    endedAt: decodeInstant(row.ended_at),
    namespaceId: row.namespace_id === null ? null : String(row.namespace_id),
    backendId: String(row.backend_id),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id),
    // As stored: null stays null and no text is mapped to another.
    outcome: row.outcome === null ? null : String(row.outcome),
    error:
      row.error === null || row.error === undefined
        ? null
        : jsonOf<RetentionRun['error']>(row.error),
    rule: jsonOf<RetentionRun['rule']>(row.rule),
    removed: jsonOf<RetentionRun['removed']>(row.removed),
    horizons: jsonOf<RetentionRun['horizons']>(row.horizons),
  };
}

/**
 * `kw_retention_runs` of the control root (14.7.1, S-172): shared by PGlite and `pg`; only a
 * deployment-scope unit has this store. The application role may insert and select, never update
 * or delete, so a run row is final once written. Raw statements: the control plugin does not list
 * the table.
 */
export function sqlRetentionRunStore(ctx: SqlUnitContext): RetentionRunStore {
  const table = `${quoteIdentifier(ctx.namespace.root)}.kw_retention_runs`;
  return {
    append: async (run) => {
      ctx.writable();
      await sqlGuard(() =>
        runSql(ctx.db, {
          sql: `insert into ${table} (run_id, started_at, ended_at, namespace_id, backend_id, tenant_id, outcome, error, rule, removed, horizons)
values ($1::uuid, $2::timestamptz, $3::timestamptz, $4::text, $5::uuid, $6::uuid, $7::text, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)`,
          parameters: [
            run.runId,
            encodeInstant(run.startedAt),
            encodeInstant(run.endedAt),
            run.namespaceId,
            run.backendId,
            run.tenantId,
            run.outcome,
            run.error === null ? null : JSON.stringify(run.error),
            JSON.stringify(run.rule),
            JSON.stringify(run.removed),
            JSON.stringify(run.horizons),
          ],
        }),
      );
    },
    list: async (query) => {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > greatestLimit) {
        throw malformedQuery(`the limit of a list is a whole number from 1 to ${greatestLimit}`);
      }
      const rows = await sqlGuard(() =>
        runSql(ctx.db, listRetentionRunsStatement(ctx.namespace.root, columns, query)),
      );
      return rows.map(runOf);
    },
  };
}
