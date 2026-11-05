import { defineEntity, type EntityType, field } from '@keelwerk/core';

const bookDef = defineEntity({
  prefix: 'book',
  dataSubject: 'addedBy',
  fields: {
    title: field.string({ maxLength: 200 }),
    isbn: field.string({ maxLength: 17 }).unique(),
    addedBy: field.subject().index(),
  },
  generated: { history: true, watch: false },
});

export interface Book extends EntityType<typeof bookDef> {}
export const book: Book = bookDef;
