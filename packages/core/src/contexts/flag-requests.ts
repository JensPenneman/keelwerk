import type { FlagRequest } from '../protocol/flag-request.ts';

/** Flag requests per module and flag (section 7.6; a flag request answers the declared default in M1, S-23). */
export interface FlagRequests {
  readonly [module: string]: { readonly [flag: string]: FlagRequest<boolean | string> };
}
