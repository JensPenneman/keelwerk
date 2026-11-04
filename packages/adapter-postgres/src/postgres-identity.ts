import type pg from 'pg';

/**
 * The cluster's identity (section 14.7.6): the system identifier and the timeline of the latest
 * checkpoint. A restore from a backup changes the first, a point-in-time recovery the second.
 */
export async function postgresIdentity(
  pool: pg.Pool,
): Promise<{ readonly systemId: string; readonly timeline: string }> {
  const result = await pool.query<{ readonly systemId: string; readonly timeline: string }>(
    `select
       (select system_identifier::text from pg_control_system()) as "systemId",
       (select timeline_id::text from pg_control_checkpoint()) as timeline`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('the cluster identity query returned no row');
  return { systemId: row.systemId, timeline: row.timeline };
}
