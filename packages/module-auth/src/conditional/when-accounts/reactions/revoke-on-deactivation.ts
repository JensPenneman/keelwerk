import { defineReaction, invoke, within } from '@keelwerk/core';
import { revokeSubject } from '../../../actions/revoke-subject.ts';
import { authBase } from '../../../base.ts';
import { subjectOfProfile } from '../../../lib/subject-of-profile.ts';
import { whenAccounts } from '../condition.ts';

/** A deactivated profile loses every credential and session, by jobs that the deactivating unit enqueues (17.2.3). */
export const revokeOnDeactivation = defineReaction(within(authBase, whenAccounts), {
  on: 'accounts.profile.deactivated',
  timing: 'inline',
  react: (event) => ({
    effects: [
      invoke(revokeSubject, {
        subject: subjectOfProfile(event.state.id),
        reason: event.data.reason ?? 'profile deactivated',
      }),
    ],
  }),
});
