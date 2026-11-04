import { defineModuleBase, type ModuleBaseType } from '../../define-module-base.ts';
import { extensionPoint } from '../../extension-point.ts';
import { field } from '../../field.ts';
import { shape } from '../../shape.ts';
import { profile } from './entities/profile.ts';
import type { IdentityProvider } from './identity-provider.ts';

const accountsBaseDef = defineModuleBase({
  id: 'accounts',
  version: '0.1.0',
  config: shape({ allowSelfRegistration: field.boolean().default(false) }),
  extensionPoints: { identityProviders: extensionPoint.set<IdentityProvider>() },
  entities: { profile },
});

export interface AccountsBase extends ModuleBaseType<typeof accountsBaseDef> {}
export const accountsBase: AccountsBase = accountsBaseDef;
