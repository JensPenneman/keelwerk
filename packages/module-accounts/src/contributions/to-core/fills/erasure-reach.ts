import { defineFill, type Id, within } from '@keelwerk/core';
import { accountsBase } from '../../../base.ts';
import { toCore } from '../contribution.ts';

/**
 * The address of a person's profile, opened under the person's key, for the erasure to find the
 * pending invitations that still name it (14.7.5). With accounts a user's subject is the id of the
 * profile (17.2.1); a subject that is no profile id has no profile.
 */
export const erasureReachFill = defineFill(within(accountsBase, toCore), 'erasureReach', (own) => [
  {
    id: 'accounts.addresses',
    *addressesOf(subject) {
      const profile = yield* own.load.accounts.profile.one({
        where: { id: subject as Id<'accounts.profile'> },
      });
      return profile === undefined ? [] : [profile.email];
    },
    *heldByOthers(addresses, subjects) {
      // The step's loads see archived profiles, and the email is unique only among profiles that are
      // not archived: a living person can hold the address of an archived profile.
      const held: string[] = [];
      for (const email of addresses) {
        const living = yield* own.load.accounts.profile.many({
          where: { email, archivedAt: { isNull: true } },
        });
        if (living.some((row) => !subjects.includes(row.id))) held.push(email);
      }
      return held;
    },
  },
]);
