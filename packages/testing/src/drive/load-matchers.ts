import type { EntityLoadMatchers } from './entity-load-matchers.ts';

/**
 * `load.accounts.profile.exists({ email })`. Any module and entity name builds a matcher; the
 * names resolve against the app when the drive runs. Under `noUncheckedIndexedAccess` a name read
 * from this index type may be undefined: tests narrow the module they use once.
 */
export interface LoadMatchers {
  readonly [module: string]: { readonly [entity: string]: EntityLoadMatchers } | undefined;
}
