import { camelFromKebab } from '../naming/camel-from-kebab.ts';

/** The key a part is mounted under and the name its file exports (section 23.4). */
export interface MountKey {
  readonly key: string;
  readonly exportName: string;
}

/**
 * `change-password` mounts as `changePassword`; a file that attaches something to another part
 * exports its kind as well, so `poll-releases` with the suffix `Schedule` exports
 * `pollReleasesSchedule` and keeps `pollReleases` as its key.
 */
export function mountKey(fileName: string, suffix: string): MountKey {
  const key = camelFromKebab(fileName);
  return { key, exportName: `${key}${suffix}` };
}
