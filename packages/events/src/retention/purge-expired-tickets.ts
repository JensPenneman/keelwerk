import type { Condition, PurgeBatch, Registry, Unit } from '@keelwerk/core';

const ticketRef = 'live.streamTicket';

/**
 * Deletes, in the caller's writing unit, the `live.streamTicket` rows of the unit's scope whose
 * `expiresAt` is before `before`, at most `limit`; answers how many and whether an expired ticket is
 * left. After a short page a read of its own answers that, because a page that skipped rows another
 * pass deleted proves nothing about what is left. Nothing when the app has no ticket entity.
 */
export async function purgeExpiredTickets(
  unit: Unit,
  registry: Registry,
  before: Temporal.Instant,
  limit: number,
): Promise<PurgeBatch> {
  const entry = registry.entities.get(ticketRef);
  if (entry === undefined) return { removed: 0, more: false };
  const where: Condition = { op: 'lt', field: 'expiresAt', value: before };
  const query = { where, select: ['id'], includeArchived: true, includeErased: true } as const;
  const page = await unit.rows.find(entry.descriptor, { ...query, page: { first: limit } });
  const removed =
    page.rows.length === 0
      ? 0
      : await unit.rows.purge(
          entry.descriptor,
          page.rows.map((row) => String(row.id)),
        );
  if (page.rows.length === limit) return { removed, more: true };
  const left = await unit.rows.find(entry.descriptor, { ...query, page: { first: 1 } });
  return { removed, more: left.rows.length > 0 };
}
