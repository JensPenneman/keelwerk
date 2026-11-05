import { defineContribution, field } from '@keelwerk/core';
import { crews } from '../../../../crews/src/module.generated.ts';
import { depots } from '../../../../depots/src/module.generated.ts';
import { ledgers } from '../../../../ledgers/src/module.generated.ts';

/** Several `when` modules: ledgers, and the crews it requires. */
export const toDepotsWhenLedgersWhenCrews = defineContribution(depots, {
  when: [ledgers, crews],
  entities: { depot: { fields: { parcelNote: field.string().optional() } } },
});
