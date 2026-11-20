import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { toCore } from '../../../src/contributions/to-core/contribution.ts';

const holdBaseDef = defineModuleBase({
  id: 'hold',
  version: '0.0.0',
  contributions: { toCore },
});

export interface HoldBase extends ModuleBaseType<typeof holdBaseDef> {}
export const holdBase: HoldBase = holdBaseDef;
