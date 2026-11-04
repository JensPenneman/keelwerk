import { ownerRows } from './owner-rows.ts';
import type { StoreFixture } from './store-fixture.ts';

/** The values of the lanes' counters of one kind (`enqueued` or `done`), by lane. */
export async function laneCount(store: StoreFixture, kind: string): Promise<readonly unknown[]> {
  const counts = await ownerRows(
    store.adapter,
    `select value::int as n from app.kw_job_lane_counts where kind = '${kind}' order by lane_id`,
  );
  return counts.map((row) => row.n);
}
