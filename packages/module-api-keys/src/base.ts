import { defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { whenAccounts } from './conditional/when-accounts/condition.ts';
import { toCore } from './contributions/to-core/contribution.ts';
import { key } from './entities/key.ts';

const apiKeysBaseDef = defineModuleBase({
  id: 'api-keys',
  version: '0.1.0',
  optional: [accounts],
  principalRef: shape({ keyId: field.ref.own('key') }),
  entities: { key },
  contributions: { toCore },
  conditions: { whenAccounts },
});

export interface ApiKeysBase extends ModuleBaseType<typeof apiKeysBaseDef> {}
export const apiKeysBase: ApiKeysBase = apiKeysBaseDef;
