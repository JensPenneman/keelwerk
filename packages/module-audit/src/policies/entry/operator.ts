import { defineRule } from '@keelwerk/core';
import { auditBase } from '../../base.ts';
import { entry } from '../../entities/entry.ts';

export const operator = defineRule(auditBase, entry, {
  effect: 'allow',
  actions: ['read'],
  principal: 'operator',
  reason: 'An operator reads the audit trail of a tenant it entered.',
});
