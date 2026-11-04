import { defineCondition, field } from '@keelwerk/core';
import { accounts } from '../../../../accounts/src/module.generated.ts';

export const whenAccounts = defineCondition([accounts], {
  entities: { credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } } },
});
