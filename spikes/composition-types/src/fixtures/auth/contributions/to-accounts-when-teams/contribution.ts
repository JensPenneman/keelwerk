import { defineContribution } from '../../../../define-contribution.ts';
import { field } from '../../../../field.ts';
import { accounts } from '../../../accounts/module.generated.ts';
import { teams } from '../../../teams/module.generated.ts';

export const toAccountsWhenTeams = defineContribution(accounts, {
  when: [teams],
  entities: { profile: { fields: { defaultTeamName: field.string().optional() } } },
});
