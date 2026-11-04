import { defineCommand, field, shape } from '@keelwerk/core';
import { loansBase } from '../base.ts';

export const closeAll = defineCommand(loansBase, {
  input: shape({ borrower: field.subject() }),
  output: shape({ closed: field.integer() }),
  execution: 'async',
  principal: ['user', 'operator'],
  *decide(input, ctx) {
    const open = yield* ctx.load.loans.loan.many({
      where: { borrower: input.borrower, state: 'open' },
    });
    return {
      events: open.map((row) => ctx.write.loans.loan.update(row, { state: 'closed' })),
      result: { closed: open.length },
    };
  },
});
