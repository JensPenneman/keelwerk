import { defineCondition, field } from '@keelwerk/core';
import { depots } from '../../../../depots/src/module.generated.ts';
import { ledgers } from '../../../../ledgers/src/module.generated.ts';

export const whenDepotsAndLedgers = defineCondition([depots, ledgers], {
  entities: { parcel: { fields: { depotId: field.string().optional() } } },
});
