import { defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { credential } from './entities/credential.ts';

const vaultBaseDef = defineModuleBase({
  id: 'vault',
  version: '0.1.0',
  config: shape({ endpoint: field.string({ maxLength: 200 }), signingKey: field.secret() }),
  entities: { credential },
});

export interface VaultBase extends ModuleBaseType<typeof vaultBaseDef> {}
export const vaultBase: VaultBase = vaultBaseDef;
