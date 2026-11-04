import { defineError, field, shape } from '@keelwerk/core';

export const isbnTaken = defineError('library.isbn_taken', {
  kind: 'conflict',
  message: 'A book with this ISBN is already in the library.',
  data: shape({ isbn: field.string() }),
});
