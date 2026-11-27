import { defineFill, type SubjectId, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { toCore } from '../contribution.ts';

/**
 * The addresses of a person's credentials, opened under the person's key, for the erasure to find
 * the pending invitations that still name them (14.7.5). Every credential of the subject answers,
 * revoked ones included: the identifier stays in the row until the erasure. Which of the addresses
 * a living subject other than the person holds is a second answer (`heldByOthers`): an identifier
 * that a live credential of another subject holds. The kernel drops what it names, whoever
 * answered the address, before any module is asked for rows.
 */
export const erasureReachFill = defineFill(within(authBase, toCore), 'erasureReach', (own) => [
  {
    id: 'auth.addresses',
    *addressesOf(subject) {
      const rows = yield* own.load.auth.credential.many({
        where: { subject: subject as SubjectId },
      });
      return rows.flatMap(({ identifier }) => (identifier === undefined ? [] : [identifier]));
    },
    *heldByOthers(addresses, subjects) {
      const held: string[] = [];
      for (const identifier of addresses) {
        const live = yield* own.load.auth.credential.many({
          where: { identifier, revokedAt: { isNull: true } },
        });
        if (live.some((row) => !subjects.includes(row.subject))) held.push(identifier);
      }
      return held;
    },
  },
]);
