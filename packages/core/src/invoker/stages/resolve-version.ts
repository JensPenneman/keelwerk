import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';

/**
 * `resolveVersion` (section 9.2): the app's head (the core app's at deployment level) until pins and credential versions exist
 * (WP-49), and no deprecation.
 */
export function resolveVersion(
  env: InvokerEnv,
  resolved: ResolvedScope,
): { readonly apiVersion: string; readonly deprecation: null } {
  return { apiVersion: env.appOf(resolved.app).head, deprecation: null };
}
