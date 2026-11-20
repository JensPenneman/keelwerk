import { defineRule } from '@keelwerk/core';
import { auditBase } from '../../base.ts';
import { entry } from '../../entities/entry.ts';
import { isTenantAdmin } from '../../lib/is-tenant-admin.ts';

export const tenantAdmin = defineRule(auditBase, entry, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  where: (ctx) => isTenantAdmin(ctx),
  reason: "A tenant's admin or owner reads its audit trail.",
});
