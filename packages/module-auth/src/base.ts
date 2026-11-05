import { contracts, defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { whenAccounts } from './conditional/when-accounts/condition.ts';
import { whenLive } from './conditional/when-live/condition.ts';
import { config } from './config.ts';
import { toAccounts } from './contributions/to-accounts/contribution.ts';
import { toCore } from './contributions/to-core/contribution.ts';
import { credential } from './entities/credential.ts';
import { resetToken } from './entities/reset-token.ts';
import { session } from './entities/session.ts';
import { resetDelivery } from './extension-points/reset-delivery.ts';

const authBaseDef = defineModuleBase({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts, contracts.live],
  config,
  extensionPoints: { resetDelivery },
  principalRef: shape({
    credentialId: field.ref.own('credential'),
    sessionId: field.ref.own('session'),
  }),
  entities: { credential, resetToken, session },
  contributions: { toAccounts, toCore },
  conditions: { whenAccounts, whenLive },
});

export interface AuthBase extends ModuleBaseType<typeof authBaseDef> {}
export const authBase: AuthBase = authBaseDef;
