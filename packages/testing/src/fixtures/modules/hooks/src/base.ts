import { defineModuleBase, field, type ModuleBaseType, shape } from '@keelwerk/core';
import { delivery } from './entities/delivery.ts';

const hooksBaseDef = defineModuleBase({
  id: 'hooks',
  version: '0.1.0',
  config: shape({ endpoint: field.string({ format: 'uri' }), signingKey: field.secret() }),
  entities: { delivery },
});

export interface HooksBase extends ModuleBaseType<typeof hooksBaseDef> {}
export const hooksBase: HooksBase = hooksBaseDef;
