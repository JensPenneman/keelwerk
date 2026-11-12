import { defineCommand, enqueue, field, shape } from '@keelwerk/core';
import { laterBase } from './base.ts';

/** Queues `library.addBook` to run at a later instant under the caller's principal, resolved again then. */
const addBookAtDef = defineCommand(laterBase, {
  input: shape({ at: field.instant(), title: field.string(), isbn: field.string() }),
  principal: 'user',
  execution: 'sync',
  decide: (input) => ({
    events: [],
    effects: [
      enqueue('library.addBook', { title: input.title, isbn: input.isbn }, { runAt: input.at }),
    ],
  }),
});

type AddBookAtPart = typeof addBookAtDef;
export interface AddBookAt extends AddBookAtPart {}
export const addBookAt: AddBookAt = addBookAtDef;
