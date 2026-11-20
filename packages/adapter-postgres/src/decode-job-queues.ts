/**
 * The queues of a parsed `kw_jobs` list; `undefined` (every queue) for a list that is not decodable,
 * because a wake-up that cannot be understood must sweep more, never less.
 */
export function decodeJobQueues(
  items: readonly string[] | undefined,
): readonly string[] | undefined {
  if (items === undefined) return undefined;
  try {
    return items.map((item) => decodeURIComponent(item));
  } catch {
    return undefined;
  }
}
