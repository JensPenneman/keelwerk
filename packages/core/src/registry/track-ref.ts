/** One active track of an entity's shape and its version (section 15.1.9); the registry lists them per entity. */
export interface TrackRef {
  /** 'accounts.profile'. */
  readonly entity: string;
  /** The track id of section 14.6.1: the owner module's id for its own fields, the contributor's track for contributed fields. */
  readonly track: string;
  readonly version: number;
  /** The contributing module; null for the owner's own track. */
  readonly contributedBy: string | null;
}
