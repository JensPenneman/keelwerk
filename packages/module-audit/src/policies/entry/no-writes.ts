import { defineRule } from '@keelwerk/core';
import { auditBase } from '../../base.ts';
import { entry } from '../../entities/entry.ts';

export const noWrites = defineRule(auditBase, entry, {
  effect: 'deny',
  actions: ['write'],
  principal: ['anonymous', 'user', 'service', 'operator', 'system'],
  reason:
    'An audit entry is written only by the audit reaction and is never created, changed, archived or restored by a caller; a policy override that allows it does not reach this deny.',
});
