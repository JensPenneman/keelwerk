import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { toCore } from '../../../src/contributions/to-core/contribution.ts';

const forgerBaseDef = defineModuleBase({
  id: 'forger',
  version: '0.0.0',
  contributions: { toCore },
});

export interface ForgerBase extends ModuleBaseType<typeof forgerBaseDef> {}
export const forgerBase: ForgerBase = forgerBaseDef;
