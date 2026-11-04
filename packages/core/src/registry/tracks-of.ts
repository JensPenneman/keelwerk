import type { ShapeRef } from '../storage/shape-ref.ts';
import type { TrackRef } from './track-ref.ts';

/**
 * The tracks of an entity's shape as `TrackRef`s, in the shape's order: `EntityEntry.tracks` is
 * derived from `descriptor.shape.tracks` with this function, so the two cannot disagree. A track id
 * with an arrow (`auth->accounts`) belongs to its contributor; the owner's own track and its
 * conditional parts (`auth[accounts]`) have none (section 14.6.1).
 */
export function tracksOf(entity: string, shape: ShapeRef): readonly TrackRef[] {
  return Object.entries(shape.tracks).map(([track, version]) => {
    const arrow = track.indexOf('->');
    return { entity, track, version, contributedBy: arrow < 0 ? null : track.slice(0, arrow) };
  });
}
