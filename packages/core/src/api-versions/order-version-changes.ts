import type { ApiVersions } from '../dsl/define-api-versions.ts';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { adoptedChanges } from './adopted-changes.ts';

function adoptionOf(api: ApiVersions | null | undefined, id: string): number {
  return (api?.dates ?? []).findIndex((date) => adoptedChanges(api, date).includes(id));
}

function numericOrder(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true });
}

/** One registered change with the index in `api.dates` of the first version that adopts it; -1 when none does. */
export interface OrderedVersionChange {
  readonly change: VersionChangeEntry;
  readonly adopted: number;
}

/**
 * Every registered change, oldest first (section 18.2): by the date that adopts it (a change
 * nobody adopts last), then by module order, `since` and id.
 */
export function orderVersionChanges(
  registry: Registry,
  api: ApiVersions | null | undefined,
): readonly OrderedVersionChange[] {
  const keyed = [...registry.versionChanges.values()].map((change) => ({
    change,
    adopted: adoptionOf(api, change.id),
  }));
  const position = (module: string): number =>
    registry.modules.findIndex((entry) => entry.id === module);
  keyed.sort(
    (left, right) =>
      (left.adopted === -1 ? Number.POSITIVE_INFINITY : left.adopted) -
        (right.adopted === -1 ? Number.POSITIVE_INFINITY : right.adopted) ||
      position(left.change.module) - position(right.change.module) ||
      numericOrder(left.change.since, right.change.since) ||
      (left.change.id < right.change.id ? -1 : left.change.id > right.change.id ? 1 : 0),
  );
  return keyed;
}
