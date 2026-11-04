import { defineQuery, field, pageOf, shape } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const search = defineQuery(accountsBase, profile, {
  input: shape({ text: field.string({ minLength: 3 }) }),
  output: pageOf(profile),
  read: (input, ctx) =>
    ctx.target.query({
      where: {
        or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }],
      },
      sort: [{ field: 'displayName', direction: 'asc' }],
    }),
});
