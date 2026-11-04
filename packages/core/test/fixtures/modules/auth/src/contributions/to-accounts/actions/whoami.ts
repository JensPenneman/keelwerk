import { defineQuery, field, shape, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { toAccounts } from '../contribution.ts';

export const whoami = defineQuery(within(authBase, toAccounts), {
  output: shape({ displayName: field.string().optional() }),
  principal: 'user',
  *read(_input, ctx) {
    const profileId = ctx.principal.subjectAs('accounts.profile');
    const row = profileId ? yield* ctx.load.accounts.profile.byId(profileId) : undefined;
    return { displayName: row?.displayName };
  },
});
