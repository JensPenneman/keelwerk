import { defineReaction, invoke, type SubjectId, system, within } from '@keelwerk/core';
import { revokeSubject } from '../../../actions/revoke-subject.ts';
import { apiKeysBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

/**
 * A deactivated profile loses every API key in the deactivating unit, as it loses every credential
 * and session (17.2.3). With accounts selected the subject of a user is the id of the profile.
 */
export const revokeOnDeactivation = defineReaction(within(apiKeysBase, whenAccounts), {
  on: 'accounts.profile.deactivated',
  timing: 'inline',
  react: (event) => ({
    effects: [
      invoke(
        revokeSubject,
        {
          subject: event.state.id as string as SubjectId,
          reason: event.data.reason ?? 'profile deactivated',
        },
        { as: system('revoke the API keys of a deactivated profile') },
      ),
    ],
  }),
});
