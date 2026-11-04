import { defineQuery } from '../../../../define-query.ts';
import { field } from '../../../../field.ts';
import { pageOf } from '../../../../page-of.ts';
import { shape } from '../../../../shape.ts';
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
