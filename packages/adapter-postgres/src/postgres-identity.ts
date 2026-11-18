import type pg from 'pg';

/**
 * The cluster's identity (section 14.7.6): the system identifier and the timeline, as decimal
 * text. A restore from a backup changes the first, a point-in-time recovery or a promotion the
 * second. The timeline is the one the next WAL record is written on (the first eight hex digits of
 * the WAL file name of the insert position), not the one of the latest checkpoint:
 * `pg_control_checkpoint()` keeps showing the old timeline after a promotion until the first
 * checkpoint on the new one completes, which can take minutes, and a process that starts in that
 * window would miss the restore. A server in recovery has no insert position and answers the
 * checkpoint's timeline.
 */
export async function postgresIdentity(
  pool: pg.Pool,
): Promise<{ readonly systemId: string; readonly timeline: string }> {
  const result = await pool.query<{ readonly systemId: string; readonly timeline: string }>(
    `select
       (select system_identifier::text from pg_control_system()) as "systemId",
       case when pg_is_in_recovery()
         then (select timeline_id::text from pg_control_checkpoint())
         else (('x' || substr(pg_walfile_name(pg_current_wal_lsn()), 1, 8))::bit(32)::int)::text
       end as timeline`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('the cluster identity query returned no row');
  return { systemId: row.systemId, timeline: row.timeline };
}
