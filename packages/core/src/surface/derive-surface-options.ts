import type { TrackSnapshot } from '../storage/track-snapshot.ts';

/** What `deriveSurface` takes beyond the app and the version. */
export interface DeriveSurfaceOptions {
  /** The module snapshots (section 13.7): the member tags they record keep the tags of `json` shape members stable when a member is inserted. */
  readonly snapshots?: readonly TrackSnapshot[];
}
