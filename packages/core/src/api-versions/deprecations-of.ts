import type { InvocationSession } from '../invoker/invocation-session.ts';
import { deprecatedFrom } from './deprecated-from.ts';
import type { DeprecationNotice } from './deprecation-notice.ts';

/**
 * The session's version notice (when `session.deprecation` is set) first, then the action's when
 * `action.deprecated` is declared and its `at` has begun on `today` (an action without `at` is in
 * force from its declaration and carries no date in its notice). `session` undefined: action notices only. The
 * notice names `action.ref` as given: callers pass the action of the surface of the caller's API
 * version, so a renamed action is announced under the name that version knows.
 */
export function deprecationsOf(
  session: Pick<InvocationSession, 'apiVersion' | 'deprecation'> | undefined,
  action:
    | {
        /** The ref at the caller's API version. */
        readonly ref: string;
        readonly deprecated?: { readonly at?: string; readonly sunset?: string };
      }
    | undefined,
  today: string,
): readonly DeprecationNotice[] {
  const notices: DeprecationNotice[] = [];
  const version = session?.deprecation;
  if (session !== undefined && version !== null && version !== undefined) {
    notices.push({
      kind: 'deprecation',
      apiVersion: session.apiVersion,
      at: version.at,
      ...(version.sunset === undefined ? {} : { sunset: version.sunset }),
    });
  }
  const deprecated = action?.deprecated;
  if (action !== undefined && deprecated !== undefined && deprecatedFrom(deprecated.at, today)) {
    notices.push({
      kind: 'deprecation',
      action: action.ref,
      ...(deprecated.at === undefined ? {} : { at: deprecated.at }),
      ...(deprecated.sunset === undefined ? {} : { sunset: deprecated.sunset }),
    });
  }
  return notices;
}
