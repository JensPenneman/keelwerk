import { defineCondition, field } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';

/** What auth adds to its own credential when accounts is selected (5.4). */
export const whenAccounts = defineCondition([accounts], {
  entities: {
    credential: { fields: { profileId: field.ref(accounts, 'profile').optional().index() } },
  },
});
