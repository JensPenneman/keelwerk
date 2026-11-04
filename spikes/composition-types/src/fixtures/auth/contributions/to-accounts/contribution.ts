import { defineContribution } from '../../../../define-contribution.ts';
import { field } from '../../../../field.ts';
import { relation } from '../../../../relation.ts';
import { accounts } from '../../../accounts/module.generated.ts';

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
