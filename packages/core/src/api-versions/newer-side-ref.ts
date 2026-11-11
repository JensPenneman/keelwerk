import type { VersionChangeEntry } from '../registry/version-change-entry.ts';

/**
 * The reference a head action carries on the newer side of a change, seen through the action
 * renames of `newer`, the changes newer than it (oldest first): the name its author saw when the
 * change was written, and so the name the change's transforms and fixtures use.
 */
export function newerSideRef(newer: readonly VersionChangeEntry[], headRef: string): string {
  let shown = headRef;
  for (const change of [...newer].reverse()) {
    const renamed = change.surface.find((spec) => spec.action === shown);
    if (renamed?.renamedFrom !== undefined) shown = renamed.renamedFrom;
  }
  return shown;
}
