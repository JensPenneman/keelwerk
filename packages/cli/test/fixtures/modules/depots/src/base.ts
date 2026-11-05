import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { depot } from './entities/depot.ts';

const depotsBaseDef = defineModuleBase({
  id: 'depots',
  version: '0.1.0',
  entities: { depot },
});

export interface DepotsBase extends ModuleBaseType<typeof depotsBaseDef> {}
export const depotsBase: DepotsBase = depotsBaseDef;
