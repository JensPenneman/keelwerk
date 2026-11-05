import type { DecideContext } from '@keelwerk/core';
import type { AuthBase } from '../base.ts';

type Own = DecideContext<AuthBase>;

/** What issuing a reset token needs of a decision's context. */
export type ResetTokenContext = Pick<Own, 'newId' | 'secrets' | 'clock'> & {
  readonly write: { readonly auth: Own['write']['auth'] };
};
