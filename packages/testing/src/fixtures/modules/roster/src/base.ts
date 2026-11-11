import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { contact } from './entities/contact.ts';

const rosterBaseDef = defineModuleBase({
  id: 'roster',
  version: '1.0.0',
  entities: { contact },
});

export interface RosterBase extends ModuleBaseType<typeof rosterBaseDef> {}
export const rosterBase: RosterBase = rosterBaseDef;
