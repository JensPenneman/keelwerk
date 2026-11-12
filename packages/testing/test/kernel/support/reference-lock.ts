import type pg from 'pg';
import { expect, vi } from 'vitest';

/**
 * Opens a transaction on `client` that has inserted, and not committed, the reference of `subject`
 * to the stream `probe.thread/<thread>`: a command that adds the same reference waits for the
 * transaction after it read (and holds `for share`) the subject's key. `commit` on the client lets it go.
 */
export async function openReferenceLock(
  client: pg.Client,
  held: { readonly tenantId: string; readonly subject: string; readonly thread: string },
): Promise<void> {
  const placements = (
    await client.query(`select schemaname from pg_tables where tablename = 'kw_subject_refs'`)
  ).rows as { schemaname: string }[];
  let holder: string | undefined;
  for (const { schemaname } of placements) {
    const keyed = await client.query(
      `select 1 from "${schemaname}".kw_subject_keys where subject_id = $1::uuid`,
      [held.subject],
    );
    if (keyed.rowCount !== 0) holder = schemaname;
  }
  if (holder === undefined) throw new Error('no schema holds the key of the subject');
  await client.query('begin');
  await client.query(`select set_config('keelwerk.scope', 'namespace', true)`);
  await client.query(
    `insert into "${holder}".kw_subject_refs (scope_id, subject_id, stream_type, stream_id) values ($1::uuid, $2::uuid, 'probe.thread', $3::uuid)`,
    [held.tenantId, held.subject, held.thread],
  );
}

/** Waits until a statement of another session waits for the lock on a reference row. */
export async function waitForReferenceLock(client: pg.Client): Promise<void> {
  await vi.waitFor(
    async () => {
      // The statistics are a snapshot per transaction: drop it to see the lock wait that began after it.
      await client.query('select pg_stat_clear_snapshot()');
      const waiting = await client.query(
        `select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%kw_subject_refs%' and pid <> pg_backend_pid()`,
      );
      expect(waiting.rowCount).toBeGreaterThan(0);
    },
    { timeout: 30_000 },
  );
}
