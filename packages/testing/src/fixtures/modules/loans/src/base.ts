import { contracts, defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { library } from '../../library/src/module.generated.ts';
import { whenLibrary } from './conditional/when-library/condition.ts';
import { whenLive } from './conditional/when-live/condition.ts';
import { toLibrary } from './contributions/to-library/contribution.ts';
import { loan } from './entities/loan.ts';

const loansBaseDef = defineModuleBase({
  id: 'loans',
  version: '0.1.0',
  optional: [library, contracts.live],
  entities: { loan },
  contributions: { toLibrary },
  conditions: { whenLibrary, whenLive },
});

export interface LoansBase extends ModuleBaseType<typeof loansBaseDef> {}
export const loansBase: LoansBase = loansBaseDef;
