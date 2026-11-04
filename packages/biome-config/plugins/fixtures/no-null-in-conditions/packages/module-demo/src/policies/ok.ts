import { defineRule } from '@keelwerk/core';

export const rule = defineRule({
  where: (ctx) => ({ ownerId: ctx.principal.subject, revokedAt: { isNull: true } }),
  check: { status: { in: ['open', 'draft'] } },
  note: null,
});
