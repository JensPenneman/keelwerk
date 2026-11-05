import { defineCommand, field, shape } from '@keelwerk/core';
import { loansBase } from '../base.ts';
import { loan } from '../entities/loan.ts';
import { alreadyLent } from '../errors/already-lent.ts';

export const lend = defineCommand(loansBase, {
  input: shape({
    bookTitle: field.string({ maxLength: 200 }),
    dueAt: field.instant(),
    note: field.text({ maxLength: 500 }).optional(),
  }),
  output: shape({ loanId: field.ref.own('loan') }),
  errors: [alreadyLent],
  execution: 'either',
  principal: 'user',
  *decide(input, ctx) {
    if (yield* ctx.load.loans.loan.exists({ bookTitle: input.bookTitle, state: 'open' })) {
      throw alreadyLent({ bookTitle: input.bookTitle });
    }
    const id = yield* ctx.newId(loan);
    return {
      events: [
        ctx.write.loans.loan.create({
          id,
          borrower: ctx.principal.subject,
          bookTitle: input.bookTitle,
          dueAt: input.dueAt,
          ...(input.note === undefined ? {} : { note: input.note }),
        }),
      ],
      result: { loanId: id },
    };
  },
});
