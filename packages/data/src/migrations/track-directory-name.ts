import { parseTrackId } from './parse-track-id.ts';

/**
 * The directory of a track under a module's `migrations/` (section 14.6.1): `own`, `to-accounts`,
 * `when-accounts`; a contribution with `when` modules is `to-projects.when-teams`, several
 * `when` modules are joined with `+`. Module ids are kebab case, so `.` and `+` never occur in one.
 */
export function trackDirectoryName(track: string): string {
  const { target, when } = parseTrackId(track);
  const conditions = when.length === 0 ? '' : `when-${when.join('+')}`;
  if (target === null) return conditions === '' ? 'own' : conditions;
  return conditions === '' ? `to-${target}` : `to-${target}.${conditions}`;
}
