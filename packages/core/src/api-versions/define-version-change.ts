import { compositionRefusal } from '../dsl/composition-refusal.ts';
import type { BaseOf, PartSource } from '../model/part-source.ts';
import type { VersionChange } from './version-change.ts';

function versionOf(source: PartSource): string | undefined {
  if (Array.isArray(source)) return undefined;
  if ('base' in source) return source.base.version;
  return 'version' in source ? source.version : undefined;
}

function above(a: string, b: string): boolean {
  const bare = (version: string): string => version.split(/[-+]/)[0] ?? version;
  return bare(a).localeCompare(bare(b), 'en', { numeric: true }) > 0;
}

/** A version change part, mounted as `changes.<key>`. */
export interface VersionChangePart<S> {
  readonly kind: 'versionChange';
  readonly source: S;
  readonly spec: object;
}

/**
 * Declares a version change of the module (section 18.2), mounted under the literal's `changes`.
 * Throws `invalidVersionChange` when `since` is above the base's version; an app source has none
 * to compare with.
 */
export function defineVersionChange<const S extends PartSource>(
  source: S,
  spec: VersionChange<BaseOf<S>>,
): VersionChangePart<S> {
  const version = versionOf(source);
  if (version !== undefined && above(spec.since, version)) {
    throw compositionRefusal({
      code: 'invalidVersionChange',
      severity: 'error',
      message: `The change since '${spec.since}' is above the module version '${version}'.`,
    });
  }
  return { kind: 'versionChange', source, spec };
}
