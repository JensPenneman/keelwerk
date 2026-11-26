import { defineRule } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

/** Only `deactivate` writes the mark: no generated write may change it (8.5). */
export const mark = defineRule(accountsBase, profile, {
  effect: 'deny',
  actions: ['write'],
  fields: ['deactivatedAt'],
  reason: 'Only a deactivation marks a profile.',
});
