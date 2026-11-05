import { defineContribution, field, relation } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';

/** What auth adds to a profile when both modules are selected (5.3). */
export const toAccounts = defineContribution(accounts, {
  entities: {
    profile: {
      fields: {
        lastLoginAt: field.instant().optional().maskable(),
        emailVerifiedAt: field.instant().optional(),
      },
      relations: { credentials: relation.many.own('credential', { by: 'profileId', to: 'id' }) },
    },
  },
});
