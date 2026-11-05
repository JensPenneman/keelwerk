import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { crews } from '../../crews/src/module.generated.ts';
import { ledger } from './entities/ledger.ts';

const ledgersBaseDef = defineModuleBase({
  id: 'ledgers',
  version: '0.1.0',
  requires: [crews],
  entities: { ledger },
});

export interface LedgersBase extends ModuleBaseType<typeof ledgersBaseDef> {}
export const ledgersBase: LedgersBase = ledgersBaseDef;
