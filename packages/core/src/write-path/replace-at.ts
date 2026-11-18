/**
 * A copy of `root` with `value` at `path`; the objects and lists along the path are copied, the
 * rest is shared.
 */
export function replaceAt(
  root: unknown,
  path: readonly (string | number | symbol)[],
  value: unknown,
): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const inner = (root as Record<string | number | symbol, unknown>)[head];
  const next = replaceAt(inner, rest, value);
  if (Array.isArray(root)) {
    const copy: unknown[] = [...root];
    copy[head as number] = next;
    return copy;
  }
  return { ...(root as object), [head]: next };
}
