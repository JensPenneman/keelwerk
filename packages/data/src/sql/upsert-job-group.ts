import type { JobGroup } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { parseGroupRate } from './parse-group-rate.ts';
import { quoteIdentifier } from './postgres/quote-identifier.ts';
import { runSql } from './run-sql.ts';
import { sqlJobGroupKey } from './sql-job-group-key.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Inserts the group's counter row with a full bucket, or re-limits an existing one; `scopeId` null spans the namespace. */
export async function upsertJobGroup(
  ctx: SqlUnitContext,
  group: JobGroup,
  scopeId: string | null,
): Promise<string> {
  const root = quoteIdentifier(ctx.namespace.root);
  const key = sqlJobGroupKey(group);
  const rate = group.rate === undefined ? null : parseGroupRate(group.rate);
  const parameters = [
    key,
    scopeId,
    group.concurrency === undefined ? null : String(group.concurrency),
    group.rate ?? null,
    String(rate?.count ?? 0),
    encodeInstant(ctx.clock.now()),
  ];
  await runSql(ctx.db, {
    sql: `insert into ${root}.kw_job_groups (id, scope_id, concurrency, rate, tokens, refilled_at)
values ($1, $2::uuid, $3::integer, $4, $5::double precision, $6::timestamptz)
on conflict (scope_id, id) do nothing`,
    parameters,
  });
  await runSql(ctx.db, {
    sql: `update ${root}.kw_job_groups set concurrency = $2::integer, rate = $3
where id = $1 and scope_id is not distinct from $4::uuid
  and (concurrency is distinct from $2::integer or rate is distinct from $3)`,
    parameters: [key, parameters[2], parameters[3], scopeId],
  });
  return key;
}
