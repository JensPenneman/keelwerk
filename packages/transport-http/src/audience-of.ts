import type { ErrorAudience } from '@keelwerk/core';
import type { HostContext } from './host-context.ts';
import type { RequestState } from './request-state.ts';

/** Operators and development see the detail; everyone else gets the public form (section 16.4.6). */
export function audienceOf(host: HostContext, state: RequestState): ErrorAudience {
  if (host.deps.development === true) {
    return 'development';
  }
  return state.session?.principal.kind === 'operator' ? 'operator' : 'public';
}
