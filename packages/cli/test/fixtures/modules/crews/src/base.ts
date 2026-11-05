import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { crew } from './entities/crew.ts';

const crewsBaseDef = defineModuleBase({
  id: 'crews',
  version: '0.1.0',
  entities: { crew },
});

export interface CrewsBase extends ModuleBaseType<typeof crewsBaseDef> {}
export const crewsBase: CrewsBase = crewsBaseDef;
