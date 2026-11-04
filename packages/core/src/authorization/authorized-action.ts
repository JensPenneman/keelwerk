import type { ActionEntry } from '../registry/action-entry.ts';

/** The members of an action the authorization stages read. */
export type AuthorizedAction = Pick<
  ActionEntry,
  | 'ref'
  | 'module'
  | 'entity'
  | 'name'
  | 'kind'
  | 'generated'
  | 'instance'
  | 'auth'
  | 'scope'
  | 'principal'
>;
