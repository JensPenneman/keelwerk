import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { membership } from '../../entities/membership.ts';

/**
 * The owner row is out of the reach of `update` and `archive`: the deny `where` filters it out
 * before the command loads it, so such a call answers `not_found` and the reason is never shown.
 */
export const ownerKept = defineRule(membersBase, membership, {
  effect: 'deny',
  actions: ['update', 'archive'],
  where: () => ({ role: 'owner' }) as const,
  reason:
    'The owner cannot be removed; ownership moves through members.membership.transferOwnership.',
});
