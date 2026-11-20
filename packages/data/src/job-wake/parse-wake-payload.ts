/** A payload of `<namespace>:<item>,<item>` or `<namespace>:*`, split. `items` is `undefined` for `*`. */
export interface WakePayload {
  readonly namespace: string;
  readonly items: readonly string[] | undefined;
}

/**
 * Splits a notification of the change feed (14.3.7): `kw_events` lists scope ids, `kw_jobs` lists
 * percent-encoded queue names, and `*` after the last colon means "everything of the namespace".
 * `undefined` for a payload without a colon.
 */
export function parseWakePayload(payload: string): WakePayload | undefined {
  const cut = payload.lastIndexOf(':');
  if (cut < 0) return undefined;
  const rest = payload.slice(cut + 1);
  return {
    namespace: payload.slice(0, cut),
    items: rest === '*' ? undefined : rest.split(',').filter((item) => item !== ''),
  };
}
