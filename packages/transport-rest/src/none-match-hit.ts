/** Whether `If-None-Match` names the row's current tag (weak comparison), so a read answers 304. */
export function noneMatchHit(ifNoneMatch: readonly string[], etag: string): boolean {
  return ifNoneMatch.some((tag) => tag === '*' || tag === etag);
}
