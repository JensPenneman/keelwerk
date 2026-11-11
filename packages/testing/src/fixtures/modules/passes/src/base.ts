import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { toCore } from './contributions/to-core/contribution.ts';
import { pass } from './entities/pass.ts';

const passesBaseDef = defineModuleBase({
  id: 'passes',
  version: '0.1.0',
  entities: { pass },
  contributions: { toCore },
});

export interface PassesBase extends ModuleBaseType<typeof passesBaseDef> {}
export const passesBase: PassesBase = passesBaseDef;
