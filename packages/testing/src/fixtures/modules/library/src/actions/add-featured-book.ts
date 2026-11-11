import { defineCommand, field, shape } from '@keelwerk/core';
import { libraryBase } from '../base.ts';
import { book } from '../entities/book.ts';
import { isbnTaken } from '../errors/isbn-taken.ts';

export const addFeaturedBook = defineCommand(libraryBase, {
  gate: 'newFlow',
  input: shape({ title: field.string({ maxLength: 200 }), isbn: field.string({ maxLength: 17 }) }),
  output: shape({ bookId: field.ref.own('book'), newFlow: field.boolean() }),
  errors: [isbnTaken],
  principal: 'user',
  *decide(input, ctx) {
    if (yield* ctx.load.library.book.exists({ isbn: input.isbn })) {
      throw isbnTaken({ isbn: input.isbn });
    }
    const on = yield* ctx.flags.library.newFlow;
    const id = yield* ctx.newId(book);
    return {
      events: [
        ctx.write.library.book.create({
          id,
          title: input.title,
          isbn: input.isbn,
          addedBy: ctx.principal.subject,
        }),
      ],
      result: { bookId: id, newFlow: on },
    };
  },
});
