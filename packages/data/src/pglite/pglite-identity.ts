import type { PGlite } from '@electric-sql/pglite';

/**
 * The database's identity, compared at connect to detect restores (section 14.7.6): the control
 * file's system identifier and the checkpoint's timeline. A PGlite directory keeps both across
 * restarts.
 */
export async function pgliteIdentity(
  database: PGlite,
): Promise<{ readonly systemId: string; readonly timeline: string }> {
  const system = await database.query<{ id: string }>(
    'select system_identifier::text as id from pg_control_system()',
  );
  const checkpoint = await database.query<{ timeline: string }>(
    'select timeline_id::text as timeline from pg_control_checkpoint()',
  );
  const systemId = system.rows[0]?.id;
  const timeline = checkpoint.rows[0]?.timeline;
  if (systemId === undefined || timeline === undefined) {
    throw new Error('PGlite did not report its system identity');
  }
  return { systemId, timeline };
}
