import { contracts, defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { accounts } from '../../accounts/src/module.generated.ts';
import { teams } from '../../teams/src/module.generated.ts';
import { whenAccounts } from './conditional/when-accounts/condition.ts';
import { whenLive } from './conditional/when-live/condition.ts';
import { toAccounts } from './contributions/to-accounts/contribution.ts';
import { toAccountsWhenTeams } from './contributions/to-accounts-when-teams/contribution.ts';
import { credential } from './entities/credential.ts';
import { session } from './entities/session.ts';

const authBaseDef = defineModuleBase({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts, teams, contracts.live],
  config: shape({
    sessionIdleMinutes: field.integer({ min: 5 }).default(720),
    pepper: field.secret(),
  }),
  principalRef: shape({
    credentialId: field.ref.own('credential'),
    sessionId: field.ref.own('session'),
  }),
  entities: { credential, session },
  contributions: { toAccounts, toAccountsWhenTeams },
  conditions: { whenAccounts, whenLive },
});

export interface AuthBase extends ModuleBaseType<typeof authBaseDef> {}
export const authBase: AuthBase = authBaseDef;
