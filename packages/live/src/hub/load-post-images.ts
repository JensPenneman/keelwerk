import type { EntityDescriptor, StorageRow, Unit } from '@keelwerk/core';

const chunk = 100;

/**
 * The current rows of the ids, archived ones included, with no plan: the kernel's own read, whose
 * rows are judged by each subscriber's plan afterwards. An id with no row (purged) is absent.
 */
export async function loadPostImages(
  unit: Unit,
  descriptor: EntityDescriptor,
  ids: readonly string[],
): Promise<Map<string, StorageRow>> {
  const rows = new Map<string, StorageRow>();
  for (let at = 0; at < ids.length; at += chunk) {
    const part = ids.slice(at, at + chunk);
    const found = await unit.rows.find(descriptor, {
      where: { op: 'in', field: 'id', value: part },
      page: { first: part.length },
      includeArchived: true,
    });
    for (const row of found.rows) rows.set(String(row.id), row);
  }
  return rows;
}
