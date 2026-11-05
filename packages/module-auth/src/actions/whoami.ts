import { defineQuery, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';

/** Who the caller is; the display name comes from the profile when accounts is selected and the subject is a profile. */
const whoamiDef = defineQuery(authBase, {
  output: shape({ subject: field.subject(), displayName: field.string().optional() }),
  principal: 'user',
  *read(_input, ctx) {
    const profileId = ctx.principal.subjectAs('accounts.profile');
    const row =
      profileId === null
        ? undefined
        : yield* ctx.load.accounts.ifPresent((accounts) => accounts.profile.byId(profileId));
    return { subject: ctx.principal.subject, displayName: row?.displayName };
  },
});

type WhoamiPart = typeof whoamiDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Whoami extends WhoamiPart {}
export const whoami: Whoami = whoamiDef;
