import { defineRule } from '@keelwerk/core';

export const rules = [
  defineRule({
    where(ctx) {
      return { ownerId: null, parentId: ctx.principal.subject }; // expect: plugin/no-null-in-conditions
    },
  }),
  defineRule({
    where: (ctx) => ({ ownerId: ctx.principal.subject ?? null }), // expect: plugin/no-null-in-conditions
  }),
  defineRule({
    where: (ctx) => ({ ownerId: ctx.principal ? ctx.principal.subject : null }), // expect: plugin/no-null-in-conditions
  }),
];
