import { defineEntity, type EntityType, field } from '@keelwerk/core';

const contactDef = defineEntity({
  prefix: 'ctc',
  fields: { displayName: field.string({ maxLength: 100 }) },
  generated: { watch: false },
});

export interface Contact extends EntityType<typeof contactDef> {}
export const contact: Contact = contactDef;
