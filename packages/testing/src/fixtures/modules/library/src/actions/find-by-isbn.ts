import { defineQuery, field, shape } from '@keelwerk/core';
import { libraryBase } from '../base.ts';

export const findByIsbn = defineQuery(libraryBase, {
  input: shape({ isbn: field.string({ maxLength: 17 }) }),
  output: shape({ bookId: field.ref.own('book').optional(), title: field.string().optional() }),
  principal: 'user',
  *read(input, ctx) {
    const row = yield* ctx.load.library.book.forCaller().one({ where: { isbn: input.isbn } });
    return { bookId: row?.id, title: row?.title };
  },
});
