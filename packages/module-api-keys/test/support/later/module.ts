import { defineModule, type ModuleType } from '@keelwerk/core';
import { addBookAt } from './add-book-at.ts';
import { laterBase } from './base.ts';
import { laterCallers } from './callers.ts';

const laterDef = defineModule(laterBase, {
  actions: { addBookAt },
  policies: { addBookAt: { laterCallers } },
});

export interface Later extends ModuleType<typeof laterDef> {}
/** A module of the tests: a command that queues work for a later instant, so a test can change the key before the work runs. */
export const later: Later = laterDef;
