import { defineQuery, field, pageOf, shape } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const search = defineQuery(accountsBase, profile, {
  input: shape({ text: field.string({ minLength: 3, maxLength: 80 }) }),
  output: pageOf(profile),
  page: { sortable: ['displayName', 'createdAt'], defaultSize: 25, maxSize: 100 },
  read: (input, ctx) =>
    ctx.target.query({
      where: {
        or: [{ displayName: { contains: input.text } }, { email: { startsWith: input.text } }],
      },
      sort: [{ field: 'displayName', direction: 'asc' }],
    }),
});
