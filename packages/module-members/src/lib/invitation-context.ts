import type { DecideContext } from '@keelwerk/core';
import type { MembersBase } from '../base.ts';

type Own = DecideContext<MembersBase>;

/** What issuing an invitation needs of a decision's context. */
export type InvitationContext = Pick<Own, 'newId' | 'secrets' | 'clock' | 'extensions'> & {
  readonly write: { readonly members: Own['write']['members'] };
};
