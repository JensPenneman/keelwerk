import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig } from 'pg';
import { connect } from './connect.ts';
import type { WaitCounts } from './wait-counts.ts';

const query = `
  select a.application_name as waiter,
         coalesce(a.wait_event_type || ':' || a.wait_event, 'CPU') as event,
         case when a.wait_event_type = 'Lock' then
           (select array_agg(b.application_name) from pg_stat_activity b where b.pid = any (pg_blocking_pids(a.pid)))
         end as blockers
  from pg_stat_activity a
  where a.application_name like 'w:%' and a.state <> 'idle'`;

const scopeOf = (applicationName: string): string => applicationName.split(':')[1] ?? '';

/** Samples writer backends every `intervalMs` on its own superuser connection until stopped. */
export async function startWaitSampler(
  admin: ClientConfig,
  intervalMs: number,
): Promise<{ stop(): Promise<WaitCounts> }> {
  const client = await connect(admin, 'sampler');
  const events: Record<string, number> = {};
  let samples = 0;
  let lockWaits = 0;
  let sameScope = 0;
  let crossScope = 0;
  let running = true;
  const loop = (async (): Promise<void> => {
    while (running) {
      const rows = await client.query<{
        waiter: string;
        event: string;
        blockers: string[] | null;
      }>(query);
      samples += 1;
      for (const row of rows.rows) {
        events[row.event] = (events[row.event] ?? 0) + 1;
        if (!row.event.startsWith('Lock:')) continue;
        lockWaits += 1;
        const blockers = row.blockers ?? [];
        if (blockers.some((blocker) => scopeOf(blocker) !== scopeOf(row.waiter))) crossScope += 1;
        else sameScope += 1;
      }
      await delay(intervalMs);
    }
  })();
  return {
    stop: async () => {
      running = false;
      await loop;
      await client.end();
      return { samples, lockWaits, sameScope, crossScope, events };
    },
  };
}
