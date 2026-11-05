import { parseTrackId } from './parse-track-id.ts';

/**
 * Whether a track is active for an app that selects these modules (section 14.6.1): the module
 * that ships it, the target of a contribution and every `when` module must all be selected. A track
 * that names a module the app does not select is dormant: it is neither applied nor part of the
 * app's history or build id.
 */
export function isTrackActive(track: string, selected: readonly string[]): boolean {
  const { module, target, when } = parseTrackId(track);
  return [module, ...(target === null ? [] : [target]), ...when].every((id) =>
    selected.includes(id),
  );
}
