import { defineRule } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const alreadyRevoked = defineRule(authBase, credential, {
  effect: 'deny',
  actions: ['revoke'],
  where: () => ({ revokedAt: { isNull: false } }),
  reason: 'This credential is already revoked.',
});
