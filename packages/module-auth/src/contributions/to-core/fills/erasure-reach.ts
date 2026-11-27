import { defineFill, normalizerRegistry, type SubjectId, within } from '@keelwerk/core';
import { authBase } from '../../../base.ts';
import { identifierBucket } from '../../../lib/identifier-bucket.ts';
import { subjectBucket } from '../../../lib/subject-bucket.ts';
import { toCore } from '../contribution.ts';

/**
 * What the erasure of a person asks of auth (14.7.5): the addresses of the person's credentials,
 * opened under the person's key, for the erasure to find the pending invitations that still name
 * them (every credential of the subject answers, revoked ones included: the identifier stays in the
 * row until the erasure); which of the addresses asked about a live credential of another subject
 * holds (`heldByOthers`), which the kernel drops for every use it makes of the address; and the
 * names of the failure buckets of the admission rule that name the person, by the subject and by
 * each address (`subjectBucket` and `identifierBucket`, the names the rule writes).
 */
export const erasureReachFill = defineFill(within(authBase, toCore), 'erasureReach', (own) => {
  const registry = normalizerRegistry();
  return [
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
      bucketsOf: ({ subject, addresses }) => [
        subjectBucket(subject),
        ...addresses.map((address) => identifierBucket(address, registry)),
      ],
    },
  ];
});
