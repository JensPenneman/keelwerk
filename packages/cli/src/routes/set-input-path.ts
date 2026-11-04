/** Sets `value` at `path` inside `target`, creating the objects on the way. */
export function setInputPath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cursor = target;
  for (const [index, key] of path.entries()) {
    if (index === path.length - 1) {
      cursor[key] = value;
      return;
    }
    const existing = cursor[key];
    if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
      cursor = existing as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    }
  }
}
