import { defineCondition } from '../../../../define-condition.ts';
import { field } from '../../../../field.ts';
import { accounts } from '../../../accounts/module.generated.ts';

export const whenAccounts = defineCondition([accounts], {
  entities: { credential: { fields: { profileId: field.ref(accounts, 'profile').optional() } } },
});
