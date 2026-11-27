import { defineFill, within } from '@keelwerk/core';
import { membersBase } from '../../../base.ts';
import { toCore } from '../contribution.ts';

/**
 * The pending invitations to an address of an erased person (14.7.5): each is its own data
 * subject, found by the keyed digest of the address, so any spelling of the address that
 * normalises to it is found. The kernel requests the erasure of each one's id, right before the
 * person's keys are destroyed.
 */
export const erasureReachFill = defineFill(within(membersBase, toCore), 'erasureReach', (own) => [
  {
    id: 'members.invitations',
    *heldBy(addresses) {
      const found = [];
      for (const email of addresses) {
        const pending = yield* own.load.members.invitation.many({
          where: { email, status: 'pending' },
        });
        found.push(...pending.map((row) => ({ type: 'members.invitation', id: row.id })));
      }
      return found;
    },
  },
]);
