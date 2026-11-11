import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';

/** The version changes one API version lacks, compiled once per registry and version (section 18.2). */
export interface VersionTranslation {
  readonly registry: Registry;
  /** The session's version; null for the code's head (jobs, explain), which lacks nothing. */
  readonly apiVersion: string | null;
  /** Oldest first: by the date that adopts a change, a change nobody adopts last. Empty: the identity. */
  readonly lacking: readonly VersionChangeEntry[];
  /** Head refs of the actions a lacking change touches; every other action passes untouched. */
  readonly touched: ReadonlySet<string>;
  /** The ref the version shows to the head ref, for actions a lacking rename touches. */
  readonly headRefs: ReadonlyMap<string, string>;
  /**
   * Per change id, the head refs whose action carries another name on the newer side of that
   * change (a later change renamed it): the key of the change's transforms. Absent: the head ref.
   */
  readonly keys: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Head ref to the ref the version shows. */
  readonly versionRefs: ReadonlyMap<string, string>;
  /** Head error code to the code the version shows, the lacking `errors` maps composed. */
  readonly errorCodes: ReadonlyMap<string, string>;
}
