import { defineFill, type Membership, within } from '@keelwerk/core';
import { membersBase } from '../../../base.ts';
import { membershipKind } from '../../../lib/membership-kind.ts';
import { toCore } from '../contribution.ts';

/**
 * The member's role once per session (8.5): a user principal of a tenant gets the role of its
 * live membership as `roles` and the membership as `memberships`; anyone else gets nothing. The
 * kernel runs it again at every revalidation, so a role change is observed there.
 */
export const principalEnrichersFill = defineFill(
  within(membersBase, toCore),
  'principalEnrichers',
  (own) => [
    {
      id: 'members.roles',
      *enrich(principal) {
        // Memberships live in a tenant: a user at backend or deployment scope has none, and reading one there is refused.
        if (principal.kind !== 'user' || principal.scope.tenant === null) return {};
        const row = yield* own.load.members.membership.one({
          where: { subject: principal.subject },
        });
        if (row === undefined) return {};
        const memberships: readonly Membership[] = [
          { kind: membershipKind, id: row.id, role: row.role },
        ];
        return { roles: [row.role], memberships };
      },
    },
  ],
);
