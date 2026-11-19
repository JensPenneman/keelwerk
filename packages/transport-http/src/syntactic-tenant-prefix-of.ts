/**
 * The tenant prefix of a path read by its syntax alone, the rule of the edge: `/t/<segment>` at the
 * start of the path, the segment up to the next `/` or the end, and the empty string for any other
 * path. A failure before the session opens knows no resolved prefix, yet a reserved path or a REST
 * mount below `/t/<segment>` must still get its defaults (security headers, problem documents).
 */
export function syntacticTenantPrefixOf(path: string): string {
  return /^\/t\/[^/]*/.exec(path)?.[0] ?? '';
}
