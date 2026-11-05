import { contracts, defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { config } from './config.ts';
import { toCore } from './contributions/to-core/contribution.ts';
import { credential } from './entities/credential.ts';
import { session } from './entities/session.ts';

const authBaseDef = defineModuleBase({
  id: 'auth',
  version: '0.1.0',
  optional: [accounts, contracts.live],
  config,
  principalRef: shape({
    credentialId: field.ref.own('credential'),
    sessionId: field.ref.own('session'),
  }),
  entities: { credential, session },
  contributions: { toCore },
});

export interface AuthBase extends ModuleBaseType<typeof authBaseDef> {}
export const authBase: AuthBase = authBaseDef;
