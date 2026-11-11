import type { LiveEarlierShare } from '../live/live-earlier-share.ts';
import {
  createEarlierImages,
  type EarlierImages,
  type EarlierImagesInput,
} from './earlier-images.ts';

/** The images each share holds, by entity and position; kept only as long as the share. */
const held = new WeakMap<LiveEarlierShare, Map<string, EarlierImages>>();

/** The images of `input.entry` at `input.since` that `share` holds, made on first use; without a share, images for this call alone. */
export function earlierImagesOf(
  share: LiveEarlierShare | undefined,
  input: EarlierImagesInput,
): EarlierImages {
  if (share === undefined) return createEarlierImages(input);
  const byKey = held.get(share) ?? new Map<string, EarlierImages>();
  held.set(share, byKey);
  const key = `${input.entry.ref}@${input.since.toString()}`;
  const known = byKey.get(key);
  if (known !== undefined) return known;
  const made = createEarlierImages(input);
  byKey.set(key, made);
  return made;
}
