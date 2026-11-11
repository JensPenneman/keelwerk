import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import type { VersionTranslation } from './version-translation.ts';

/** The key under which `change` lists its transforms for the head action `headRef`: the ref on the newer side of the change. */
export function transformKey(
  translation: VersionTranslation,
  change: VersionChangeEntry,
  headRef: string,
): string {
  return translation.keys.get(change.id)?.get(headRef) ?? headRef;
}
