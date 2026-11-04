import type { JobAttempt } from '@keelwerk/core';
import { encodeInstant } from './encode-instant.ts';
import { jobUnitScopeId } from './job-unit-scope-id.ts';
import { heartbeatStatement } from './postgres/heartbeat-statement.ts';
import { runSql } from './run-sql.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';

/** Renews the leases of a worker's attempts in one statement; answers those whose lease still holds (9.5.4). */
export async function sqlJobHeartbeat(
  ctx: SqlUnitContext,
  attempts: readonly JobAttempt[],
  worker: string,
  leaseMs: number,
): Promise<readonly JobAttempt[]> {
  const valid = attempts.filter((attempt) => /^\d+$/.test(attempt.jobId));
  if (valid.length === 0) return [];
  const rows = await runSql(
    ctx.db,
    heartbeatStatement(
      ctx.namespace.root,
      valid,
      worker,
      encodeInstant(ctx.clock.now().add({ milliseconds: leaseMs })),
      jobUnitScopeId(ctx),
    ),
  );
  const held = new Set(rows.map((row) => `${String(row.id)}:${Number(row.attempt)}`));
  return valid.filter((attempt) => held.has(`${attempt.jobId}:${attempt.attempt}`));
}
