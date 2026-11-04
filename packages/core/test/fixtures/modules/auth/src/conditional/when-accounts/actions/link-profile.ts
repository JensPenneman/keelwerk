import { defineCommand, field, shape, within } from '@keelwerk/core';
import { accounts } from '../../../../../accounts/src/module.generated.ts';
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
