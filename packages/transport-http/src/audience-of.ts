import type { ErrorAudience } from '@keelwerk/core';
import { audienceOf as coreAudienceOf } from '@keelwerk/core/http';
import type { HostContext } from './host-context.ts';
import type { RequestState } from './request-state.ts';

/** Operators and development see the detail; everyone else gets the public form (section 16.4.6): core's one rule, over the session the request has opened (none yet: development or public). */
export function audienceOf(host: HostContext, state: RequestState): ErrorAudience {
  const development = host.deps.development === true;
  if (state.session === undefined) return development ? 'development' : 'public';
  return coreAudienceOf(state.session, development);
}
