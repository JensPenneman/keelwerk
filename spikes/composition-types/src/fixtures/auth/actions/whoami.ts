import { defineQuery } from '../../../define-query.ts';
import { field } from '../../../field.ts';
import type { Id } from '../../../id.ts';
import { shape } from '../../../shape.ts';
import { authBase } from '../base.ts';

export const whoami = defineQuery(authBase, {
  input: shape({ profileId: field.string() }),
  output: shape({ subject: field.subject(), displayName: field.string().optional() }),
  principal: 'user',
  *read(input, ctx) {
    const profileId = input.profileId as Id<'accounts.profile'>;
    const row = yield* ctx.load.accounts.ifPresent((a) => a.profile.byId(profileId));
    return { subject: ctx.principal.subject, displayName: row?.displayName };
  },
});
