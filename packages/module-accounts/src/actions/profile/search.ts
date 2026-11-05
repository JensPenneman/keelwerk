import { defineQuery, field, pageOf, shape } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const search = defineQuery(accountsBase, profile, {
  input: shape({ text: field.string({ minLength: 3, maxLength: 80 }) }),
  output: pageOf(profile),
  page: { sortable: ['displayName', 'createdAt'], defaultSize: 25, maxSize: 100 },
  read: (input, ctx) =>
    ctx.target.query({
      // A caller who cannot read `email` cannot filter by it either (17.2.1, S-104e).
      where: ctx.ability.canFilterBy('accounts.profile.search', 'email')
        ? {
            or: [
              { displayName: { startsWith: input.text } },
              { email: { startsWith: input.text } },
            ],
          }
        : { displayName: { startsWith: input.text } },
      sort: [{ field: 'displayName', direction: 'asc' }],
    }),
});
