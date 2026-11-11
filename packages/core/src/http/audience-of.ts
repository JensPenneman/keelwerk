import type { ErrorAudience } from '../errors/error-audience.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';

/** Development sees everything, operators see the detail; everyone else gets the public form (section 16.4.6). */
export function audienceOf(session: InvocationSession, development: boolean): ErrorAudience {
  if (development) return 'development';
  return session.principal.kind === 'operator' ? 'operator' : 'public';
}
