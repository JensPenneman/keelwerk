import { defineRule } from '@keelwerk/core';
import { apiKeysBase } from '../../base.ts';
import { key } from '../../entities/key.ts';

/**
 * A revoked key is out of the reach of `revoke`. The deny `where` filters the row out before the
 * command loads it, so a second revoke answers `not_found` and the reason below is never shown.
 */
export const alreadyRevoked = defineRule(apiKeysBase, key, {
  effect: 'deny',
  actions: ['revoke'],
  where: () => ({ revokedAt: { isNull: false } }),
  reason: 'This API key is already revoked.',
});
