import { contracts } from '../../contracts.ts';
import { defineModuleBase, type ModuleBaseType } from '../../define-module-base.ts';
import { field } from '../../field.ts';
import { shape } from '../../shape.ts';
import { accounts } from '../accounts/module.generated.ts';
import { teams } from '../teams/module.generated.ts';
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
  entities: { credential, session },
  contributions: { toAccounts, toAccountsWhenTeams },
  conditions: { whenAccounts, whenLive },
});

export interface AuthBase extends ModuleBaseType<typeof authBaseDef> {}
export const authBase: AuthBase = authBaseDef;
