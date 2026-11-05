import { defineRule } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const frozen = defineRule(accountsBase, profile, {
  effect: 'deny',
  actions: ['deactivate', 'update'],
  where: () => ({ deactivatedAt: { isNull: false } }),
  reason: 'A deactivated profile is read-only.',
});
