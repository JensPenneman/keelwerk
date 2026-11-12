import { defineRule } from '@keelwerk/core';
import { apiKeysBase } from '../../base.ts';
import { key } from '../../entities/key.ts';

/**
 * An operator revokes a key of a tenant it entered, and reads none: module-auth gives an operator no
 * read of a person's credentials and sessions and no revoke of them outside a deactivation, so a key
 * is reached through the deactivation and through this one verb.
 */
export const operator = defineRule(apiKeysBase, key, {
  effect: 'allow',
  actions: ['revoke'],
  principal: 'operator',
  reason: 'An operator revokes the API key of a person.',
});
