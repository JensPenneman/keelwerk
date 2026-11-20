/**
 * A queue name as it is listed in a `kw_jobs` payload (`<namespace>:<queue>,<queue>`): percent-encoded,
 * so a colon or a comma in the name cannot cut the list, and `*` too, so no queue is taken for "every
 * queue". Queue names are free text.
 */
export function encodeJobQueue(queue: string): string {
  return encodeURIComponent(queue).replaceAll('*', '%2A');
}
