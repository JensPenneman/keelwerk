import { defineReaction, invoke, type SubjectId, within } from '@keelwerk/core';
import { revokeSubject } from '../../../actions/revoke-subject.ts';
import { authBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

export const revokeOnDeactivation = defineReaction(within(authBase, whenAccounts), {
  on: 'accounts.profile.deactivated',
  timing: 'inline',
  react: (event) => ({
    effects: [
      invoke(revokeSubject, {
        subject: event.state.id as string as SubjectId,
        reason: event.data.reason ?? 'deactivated',
      }),
    ],
  }),
});
