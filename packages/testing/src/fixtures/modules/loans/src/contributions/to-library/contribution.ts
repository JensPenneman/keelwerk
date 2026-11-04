import { defineContribution, field } from '@keelwerk/core';
import { library } from '../../../../library/src/module.generated.ts';

export const toLibrary = defineContribution(library, {
  entities: { book: { fields: { reservedBy: field.subject().optional() } } },
});
