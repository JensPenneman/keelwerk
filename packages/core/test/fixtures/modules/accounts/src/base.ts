import {
  defineModuleBase,
  extensionPoint,
  field,
  type ModuleBaseType,
  shape,
} from '@keelwerk/core';
import { profile } from './entities/profile.ts';
import type { IdentityProvider } from './extension-points/identity-provider.ts';

const accountsBaseDef = defineModuleBase({
  id: 'accounts',
  version: '0.1.0',
  config: shape({ allowSelfRegistration: field.boolean().default(false) }),
  extensionPoints: { identityProviders: extensionPoint.set<IdentityProvider>() },
  entities: { profile },
});

export interface AccountsBase extends ModuleBaseType<typeof accountsBaseDef> {}
export const accountsBase: AccountsBase = accountsBaseDef;
