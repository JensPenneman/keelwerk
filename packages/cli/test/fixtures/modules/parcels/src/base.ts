import { defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { depots } from '../../depots/src/module.generated.ts';
import { ledgers } from '../../ledgers/src/module.generated.ts';
import { whenDepotsAndLedgers } from './conditional/when-depots-and-ledgers/condition.ts';
import { toDepotsWhenLedgersWhenCrews } from './contributions/to-depots-when-ledgers-when-crews/contribution.ts';
import { parcel } from './entities/parcel.ts';

const parcelsBaseDef = defineModuleBase({
  id: 'parcels',
  version: '0.1.0',
  optional: [depots, ledgers],
  entities: { parcel },
  contributions: { toDepotsWhenLedgersWhenCrews },
  conditions: { whenDepotsAndLedgers },
});

export interface ParcelsBase extends ModuleBaseType<typeof parcelsBaseDef> {}
export const parcelsBase: ParcelsBase = parcelsBaseDef;
