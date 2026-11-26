import { defineFill, errors, within } from '@keelwerk/core';
import { accountsBase } from '../../../base.ts';
import { toCore } from '../contribution.ts';

/**
 * Refuses a user whose `subjectAs('accounts.profile')` names a deactivated profile (8.5, 17.2.3):
 * the kernel runs it at every resolution (a request, a revalidation, a redeemed ticket, a job), so
 * the person is `unauthenticated` from the deactivation's commit, whatever a job has revoked by
 * then. A redeemed ticket answers `core.ticket_invalid` instead. It reads the profile and returns
 * nothing, and no personal field is opened. The answer names no reason: the caller learns only that
 * it is not authenticated. At a scope without a tenant it does nothing, as the mark is judged
 * within a tenant.
 */
export const principalEnrichersFill = defineFill(
  within(accountsBase, toCore),
  'principalEnrichers',
  (own) => [
    {
      id: 'accounts.deactivated',
      *enrich(principal) {
        // The mark is judged within a tenant (8.5): profiles are tenant data, and a load at another scope is refused.
        if (principal.kind !== 'user' || principal.scope.tenant === null) return {};
        const profileId = principal.subjectAs('accounts.profile');
        if (profileId === null) return {};
        const deactivated = yield* own.load.accounts.profile.exists({
          id: profileId,
          deactivatedAt: { isNull: false },
        });
        if (deactivated) throw errors.unauthenticated('The credentials were not accepted.');
        return {};
      },
    },
  ],
);
