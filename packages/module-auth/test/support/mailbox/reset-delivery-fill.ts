import { defineFill, within } from '@keelwerk/core';
import { mailboxBase } from './base.ts';
import { delivered } from './delivered.ts';
import { toAuth } from './to-auth.ts';

/** Keeps every reset message for the test to read. The token stays in test memory, never in an effect. */
export const resetDeliveryFill = defineFill(within(mailboxBase, toAuth), 'resetDelivery', () => [
  {
    id: 'mailbox.test',
    *deliver(message) {
      delivered.push(message);
      yield* [];
      return [];
    },
  },
]);
