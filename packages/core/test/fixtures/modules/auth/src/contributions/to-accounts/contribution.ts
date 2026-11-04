import { defineContribution, field, relation } from '@keelwerk/core';
import { accounts } from '../../../../accounts/src/module.generated.ts';

export const toAccounts = defineContribution(accounts, {
  entities: {
    profile: {
      fields: {
        lastLoginAt: field.instant().optional().maskable(),
        lastCredentialId: field.ref.own('credential').optional(),
      },
      relations: { credentials: relation.many.own('credential', { by: 'subject', to: 'id' }) },
    },
  },
});
