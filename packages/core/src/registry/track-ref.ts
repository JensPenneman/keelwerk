/** One active track of an entity's shape and its version (section 15.1.9); the registry lists them per entity. */
export interface TrackRef {
  /** 'accounts.profile'. */
  readonly entity: string;
  /** 'base' for the entity's own fields, else the contributing module's id. */
  readonly track: string;
  readonly version: number;
  /** The contributing module; null for the owner's own track. */
  readonly contributedBy: string | null;
}
