import { defineContribution, field } from '@keelwerk/core';
import { accounts } from '../../../../accounts/src/module.generated.ts';
import { teams } from '../../../../teams/src/module.generated.ts';

export const toAccountsWhenTeams = defineContribution(accounts, {
  when: [teams],
  entities: { profile: { fields: { defaultTeamName: field.string().optional() } } },
});
