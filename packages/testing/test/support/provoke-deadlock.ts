import pg from 'pg';

/**
 * Makes PostgreSQL end exactly one deadlock between two clients of the database at `url`, on
 * purpose: each holds one advisory lock, the first asks for the second's, and only when a look sees
 * that it waits does the second ask for the first's. Both clients are ended before it returns, and
 * it throws unless exactly one of the two was refused, with code 40P01.
 */
export async function provokeDeadlock(url: string, tag: string): Promise<void> {
  const open = async (name: string): Promise<pg.Client> => {
    const client = new pg.Client({
      connectionString: url,
      // biome-ignore lint/style/useNamingConvention: the key is the driver's option name
      application_name: `${tag}-${name}`,
    });
    client.on('error', () => undefined);
    await client.connect();
    return client;
  };
  const first = await open('first');
  const second = await open('second');
  try {
    await first.query('begin');
    await second.query('begin');
    await first.query('select pg_advisory_xact_lock(7001)');
    await second.query('select pg_advisory_xact_lock(7002)');
    const firstAsks = first.query('select pg_advisory_xact_lock(7002)');
    // The first waits for the lock the second holds, for certain; only then does the second ask.
    for (;;) {
      const waiting = await second.query(
        `select 1 from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'`,
        [`${tag}-first`],
      );
      if (waiting.rowCount !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const secondAsks = second.query('select pg_advisory_xact_lock(7001)');
    const outcomes = await Promise.allSettled([firstAsks, secondAsks]);
    const refused = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [(outcome.reason as { code?: string }).code] : [],
    );
    if (refused.length !== 1 || refused[0] !== '40P01') {
      throw new Error(`expected exactly one deadlock (40P01), saw ${JSON.stringify(refused)}`);
    }
  } finally {
    await first.query('rollback').catch(() => undefined);
    await second.query('rollback').catch(() => undefined);
    await Promise.all([first.end(), second.end()]);
  }
}
