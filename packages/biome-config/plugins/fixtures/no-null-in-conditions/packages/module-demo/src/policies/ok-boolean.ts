import { defineRule } from '@keelwerk/core';

export const boolean = defineRule({
  where: (ctx) => ctx.principal.subject !== null,
});
