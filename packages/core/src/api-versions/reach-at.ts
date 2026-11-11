import { isMemberRecord } from './is-member-record.ts';

/** One value a position path reaches, with the concrete path to it (array indexes included). */
export interface ReachedAt {
  readonly value: unknown;
  readonly path: readonly (string | number)[];
}

/** The values `path` reaches in `value` (`'*'` steps into every array item); a missing step reaches none. */
export function reachAt(value: unknown, path: readonly string[]): readonly ReachedAt[] {
  let level: ReachedAt[] = [{ value, path: [] }];
  for (const step of path) {
    level = level.flatMap((item) => {
      if (step === '*') {
        return Array.isArray(item.value)
          ? (item.value as unknown[]).map((child, index) => ({
              value: child,
              path: [...item.path, index],
            }))
          : [];
      }
      return isMemberRecord(item.value) && Object.hasOwn(item.value, step)
        ? [{ value: item.value[step], path: [...item.path, step] }]
        : [];
    });
  }
  return level;
}
