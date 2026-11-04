import { defineCondition, field } from '@keelwerk/core';
import { library } from '../../../../library/src/module.generated.ts';

export const whenLibrary = defineCondition([library], {
  entities: { loan: { fields: { bookId: field.ref(library, 'book').optional() } } },
});
