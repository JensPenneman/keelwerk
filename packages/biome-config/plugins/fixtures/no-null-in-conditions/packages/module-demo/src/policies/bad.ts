import { defineRule } from '@keelwerk/core';

export const rule = defineRule({
  where: (ctx) => ({ ownerId: null, parentId: ctx.principal.subject }), // expect: plugin/no-null-in-conditions
  check: { status: { in: ['open', null] } }, // expect: plugin/no-null-in-conditions
  filter: (ctx) => ctx.principal.subject === null,
});
