import { sha256 } from '../crypto/sha256.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';

/**
 * The shape id stored with every event of a process's state stream (S-124): the hash of the
 * process id and its tracks (none), built as an entity's shape id is. It is constant per process;
 * payload evolution goes through the event's schema version (15.1.9). No `kw_shapes` row is written
 * for it yet: the first work that writes those rows writes this id with tracks `{}`.
 */
export function processShapeId(processId: string): string {
  return sha256(canonicalizeJson({ process: processId, tracks: {} }));
}
