import { defineStream, field, shape } from '@keelwerk/core';

export const annotations = defineStream({
  key: field.ref.own('book'),
  record: shape({ text: field.string({ maxLength: 500 }).personal() }),
  readAs: 'book',
});
