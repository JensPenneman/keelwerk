import { isMemberRecord } from './is-member-record.ts';
import { reachAt } from './reach-at.ts';

/** One object a position path reaches, with the concrete path to it (array indexes included). */
export interface RowAt {
  readonly row: Readonly<Record<string, unknown>>;
  readonly path: readonly (string | number)[];
}

/** The objects `path` reaches in `value` (`'*'` steps into every array item); a missing step reaches none. */
export function rowsAt(value: unknown, path: readonly string[]): readonly RowAt[] {
  return reachAt(value, path).flatMap((item) =>
    isMemberRecord(item.value) ? [{ row: item.value, path: item.path }] : [],
  );
}
