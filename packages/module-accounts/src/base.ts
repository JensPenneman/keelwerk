import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { config } from './config.ts';
import { toCore } from './contributions/to-core/contribution.ts';
import { profile } from './entities/profile.ts';
import { identityProviders } from './extension-points/identity-providers.ts';

const accountsBaseDef = defineModuleBase({
  id: 'accounts',
  version: '0.1.0',
  config,
  extensionPoints: { identityProviders },
  entities: { profile },
  contributions: { toCore },
});

export interface AccountsBase extends ModuleBaseType<typeof accountsBaseDef> {}
export const accountsBase: AccountsBase = accountsBaseDef;
