import { defineModule, type ModuleType } from '@keelwerk/core';
import { addBookAt } from './add-book-at.ts';
import { laterBase } from './base.ts';
import { laterCallers, pingAtCallers, pingRunners } from './callers.ts';
import { cancelCallers } from './cancel-callers.ts';
import { cancelTimerKey } from './cancel-timer-key.ts';
import { ping } from './ping.ts';
import { pingAt } from './ping-at.ts';

const laterDef = defineModule(laterBase, {
  actions: { addBookAt, cancelTimerKey, ping, pingAt },
  policies: {
    addBookAt: { laterCallers },
    cancelTimerKey: { cancelCallers },
    ping: { pingRunners },
    pingAt: { pingAtCallers },
  },
});

export interface Later extends ModuleType<typeof laterDef> {}
/**
 * A module of the tests: a command that queues work for a later instant, so a test can change the
 * key before the work runs, and one that cancels a timer by a key text.
 */
export const later: Later = laterDef;
