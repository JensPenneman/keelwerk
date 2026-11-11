import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import { newerSideRef } from './newer-side-ref.ts';

/**
 * The actions of the app on the newer side of a change, by the name they carry there, each with
 * its head reference; `newer` are the changes newer than it, oldest first.
 */
export function actionsAt(
  registry: Registry,
  newer: readonly VersionChangeEntry[],
): ReadonlyMap<string, string> {
  return new Map([...registry.actions.keys()].map((head) => [newerSideRef(newer, head), head]));
}
