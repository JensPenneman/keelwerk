import { defineCommand, field, shape } from '@keelwerk/core';
import { loansBase } from '../base.ts';

/** A public sign-in at the loans desk: the browser gets the ticket as a session cookie, every other client in the body (16.4.10). */
export const openDesk = defineCommand(loansBase, {
  auth: { public: true },
  input: shape({ desk: field.string({ maxLength: 40 }) }),
  output: shape({ ticket: field.string(), desk: field.string() }),
  execution: 'sync',
  hints: {
    http: {
      cookie: {
        set: { name: '__Host-kw-desk', from: 'ticket' },
        omitFromBody: ['ticket'],
      },
    },
  },
  decide(input) {
    return { events: [], result: { ticket: `ticket-${input.desk}`, desk: input.desk } };
  },
});
