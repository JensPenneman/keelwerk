/**
 * The unique `slot` of a core.flag row: the key for the deployment-wide row, `<key>@<backendId>`
 * for a backend's row. Stored format: no flag key holds `@` (the key of `core.flag.set` and the
 * compose check `invalidFlagName` enforce it), so no two rows share a slot.
 */
export function flagSlotOf(key: string, backendId: string | null): string {
  return backendId === null ? key : `${key}@${backendId}`;
}
