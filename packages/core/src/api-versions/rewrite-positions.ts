import { isMemberRecord } from './is-member-record.ts';

/**
 * Applies `rewrite` to what `path` reaches in `value` and returns the new value, copying only the
 * objects and arrays on the way (`'*'` steps into every array item). A missing step leaves the
 * value as it is, and an unchanged result is the same object.
 */
export function rewritePositions(
  value: unknown,
  path: readonly string[],
  rewrite: (target: unknown) => unknown,
): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return rewrite(value);
  if (step === '*') {
    if (!Array.isArray(value)) return value;
    let changed = false;
    const next = value.map((item: unknown) => {
      const done = rewritePositions(item, rest, rewrite);
      if (done !== item) changed = true;
      return done;
    });
    return changed ? next : value;
  }
  if (!isMemberRecord(value) || !Object.hasOwn(value, step)) return value;
  const child = value[step];
  const done = rewritePositions(child, rest, rewrite);
  return done === child ? value : { ...value, [step]: done };
}
