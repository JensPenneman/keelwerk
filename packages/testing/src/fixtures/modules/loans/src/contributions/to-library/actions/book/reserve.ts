import { defineCommand, within } from '@keelwerk/core';
import { loansBase } from '../../../../base.ts';
import { toLibrary } from '../../contribution.ts';

export const reserve = defineCommand(within(loansBase, toLibrary), 'book', {
  principal: 'user',
  decide: (_input, current, ctx) => [
    ctx.write.library.book.update(current, { reservedBy: ctx.principal.subject }),
  ],
});
