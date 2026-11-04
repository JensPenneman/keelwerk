import { defineCommand } from '../../../../../define-command.ts';
import { field } from '../../../../../field.ts';
import { shape } from '../../../../../shape.ts';
import { within } from '../../../../../within.ts';
import { accounts } from '../../../../accounts/module.generated.ts';
import { authBase } from '../../../base.ts';
import { whenAccounts } from '../condition.ts';

export const linkProfile = defineCommand(within(authBase, whenAccounts), {
  input: shape({
    credentialId: field.ref.own('credential'),
    profileId: field.ref(accounts, 'profile'),
  }),
  *decide(input, ctx) {
    const profile = yield* ctx.load.accounts.profile.byId(input.profileId);
    return profile
      ? [ctx.write.auth.credential.update(input.credentialId, { profileId: profile.id })]
      : [];
  },
});
