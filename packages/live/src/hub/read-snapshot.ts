import type { EntityChange, LiveFrame, LiveKernel, LiveView } from '@keelwerk/core';
import type { SubscriptionBuffer } from './subscription-buffer.ts';
import type { VisibilitySet } from './visibility-set.ts';

/** Rows of a snapshot per read (D3, D7). */
const snapshotPage = 100;

/** What the start of a subscription reads its snapshot with. */
export interface ReadSnapshotInput {
  /** The kernel's read, bound to the start limiter and to the subscription's end. */
  readonly read: LiveKernel['read'];
  readonly kernel: LiveKernel;
  readonly view: LiveView;
  readonly buffer: SubscriptionBuffer;
  readonly set: VisibilitySet;
  /** Queues an item; false when the stream ended or overflowed. */
  readonly emit: (frame: LiveFrame<EntityChange<unknown>>) => boolean;
  readonly ended: () => boolean;
  readonly timeoutMs: number;
}

/**
 * The rows of a `from: 'beginning'` subscription, a page at a time, as `changed` (or `archived`)
 * items, adding each to the visibility set. Waits for the buffer to drop below half between pages, so
 * a slow client holds back the reads. False when the stream ended or overflowed on the way.
 */
export async function readSnapshot(input: ReadSnapshotInput): Promise<boolean> {
  const { kernel, view: now, buffer, set } = input;
  let after: string | undefined;
  for (;;) {
    await buffer.whenBelowHalf();
    if (input.ended()) return false;
    const page = await input.read(
      async (unit) => {
        const found = await unit.rows.find(kernel.descriptor, {
          where: now.selection,
          sort: [{ field: 'id', direction: 'asc' }],
          page: { first: snapshotPage, ...(after === undefined ? {} : { after }) },
          ...(now.includeArchived ? { includeArchived: true } : {}),
        });
        const rows = found.rows.filter((row) => now.inFilter(row));
        return { found, rows, shown: await now.present(unit, rows) };
      },
      { timeoutMs: input.timeoutMs },
    );
    for (const [index, row] of page.rows.entries()) {
      const shown = page.shown[index];
      if (shown === undefined) continue;
      const id = String(row.id);
      const archived = row.archivedAt !== undefined && row.archivedAt !== null;
      const event = {
        type: archived ? 'archived' : 'changed',
        id,
        version: Number(row.version),
        row: now.project(shown),
      } as EntityChange<unknown>;
      if (!input.emit({ event })) return false;
      set.add(id);
    }
    if (!page.found.pageInfo.hasNextPage || page.found.pageInfo.endCursor === null) return true;
    after = page.found.pageInfo.endCursor;
  }
}
