/** The most effects one status watch follows: below the hub's default `maxBufferedItems` of 1000, so a snapshot fits a subscriber's queue. */
const maxIds = 100;

/** The distinct ids of a status watch when `ids` is an array of strings that holds 1 to 100 distinct ones; undefined otherwise. The one bound of the status leaf. */
export function distinctEffectIds(ids: unknown): readonly string[] | undefined {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return undefined;
  const distinct = [...new Set(ids as readonly string[])];
  return distinct.length < 1 || distinct.length > maxIds ? undefined : distinct;
}
