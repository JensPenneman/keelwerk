import pg from 'pg';

/** A lock a test holds on a table until it lets go. */
export interface TableLock {
  /** Commits the holding transaction: every statement that waited for the lock goes on. */
  release(): Promise<void>;
}

/**
 * Holds a SHARE lock on the table of that name, in every schema that has one, so that statements
 * that write to it wait while reads go through: two commands that run at the same moment both read
 * the state before either writes, as two nodes do on PostgreSQL at READ COMMITTED.
 */
export async function holdTableLock(adminUrl: string, table: string): Promise<TableLock> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('begin');
    const found = await client.query<{ schemaname: string }>(
      'select schemaname from pg_tables where tablename = $1',
      [table],
    );
    if (found.rows.length === 0) throw new Error(`no table ${table}`);
    for (const { schemaname } of found.rows) {
      await client.query(`lock table "${schemaname}"."${table}" in share mode`);
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  return {
    release: async () => {
      try {
        await client.query('commit');
      } finally {
        await client.end();
      }
    },
  };
}

/** Resolves once `count` backends of the database wait for a lock; a lock nobody waits for ends with the case's own limit. */
export async function waitForLockWaiters(adminUrl: string, count: number): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (;;) {
      const waiting = await client.query<{ waiting: string }>(
        "select count(*) as waiting from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and pid <> pg_backend_pid()",
      );
      if (Number(waiting.rows[0]?.waiting ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    await client.end();
  }
}
