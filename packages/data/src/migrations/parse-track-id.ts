const pattern =
  /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:->([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*))?(?:\[([^\]]+)\])?$/;

/** The parts of a track id. */
export interface ParsedTrackId {
  /** The module whose package ships the track. */
  readonly module: string;
  /** The module whose tables a contribution adds to; null for an own track and a conditional part. */
  readonly target: string | null;
  /** The `when` modules in brackets. */
  readonly when: readonly string[];
}

/** Splits a track id into its module, target and `when` modules; a malformed id throws a `TypeError`. */
export function parseTrackId(id: string): ParsedTrackId {
  const match = pattern.exec(id);
  if (match === null || match[1] === undefined) throw new TypeError(`${id} is not a track id`);
  return {
    module: match[1],
    target: match[2] ?? null,
    when: match[3] === undefined ? [] : match[3].split(','),
  };
}
