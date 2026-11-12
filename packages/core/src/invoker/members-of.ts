import type { StorageRow } from '../storage/storage-row.ts';

/** The rows with exactly the members of `members` they have: a kernel source's view of its own entity. */
export function membersOf(
  rows: readonly StorageRow[],
  members: readonly string[],
): readonly Record<string, unknown>[] {
  return rows.map((row) => {
    const view: Record<string, unknown> = {};
    for (const member of members) {
      if (Object.hasOwn(row, member)) view[member] = row[member];
    }
    return view;
  });
}
