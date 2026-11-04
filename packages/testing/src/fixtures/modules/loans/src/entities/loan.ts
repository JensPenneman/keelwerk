import { defineEntity, type EntityType, field } from '@keelwerk/core';

const loanDef = defineEntity({
  prefix: 'loan',
  dataSubject: 'borrower',
  fields: {
    borrower: field.subject().index(),
    bookTitle: field.string({ maxLength: 200 }),
    dueAt: field.instant(),
    state: field.enum(['open', 'closed']).default('open'),
    note: field.text({ maxLength: 500 }).optional().maskable(),
  },
  generated: { set: false },
});

export interface Loan extends EntityType<typeof loanDef> {}
export const loan: Loan = loanDef;
