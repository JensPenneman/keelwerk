import { defineModule, defineRule, defineSchedule, type ModuleType } from '@keelwerk/core';
import { tickerBase } from './ticker-base.ts';
import {
  armBackendTimer,
  armTimer,
  disarm,
  escalate,
  escalateChosen,
  escalateFailing,
  escalateLater,
  escalateShortLived,
  fire,
  invokeUp,
  invokeUpAsSystem,
  reachDown,
  recordBeat,
  recordBeatShortLived,
  recordTick,
} from './ticker-commands.ts';

const everyTenant = defineSchedule(tickerBase, {
  every: '5m',
  scope: 'each-tenant',
  jitter: '30s',
  invoke: recordTick,
  input: (tick) => ({ schedule: 'everyTenant', at: tick.at.toString() }),
});

const everyBackend = defineSchedule(tickerBase, {
  every: '5m',
  scope: 'backend',
  invoke: recordBeat,
  input: (tick) => ({ source: 'everyBackend', at: tick.at.toString() }),
});

const user = { effect: 'allow', principal: 'user' } as const;

const tickerDef = defineModule(tickerBase, {
  actions: {
    recordTick,
    recordBeat,
    fire,
    armTimer,
    armBackendTimer,
    disarm,
    escalate,
    escalateChosen,
    escalateFailing,
    escalateLater,
    escalateShortLived,
    recordBeatShortLived,
    invokeUp,
    invokeUpAsSystem,
    reachDown,
  },
  policies: {
    recordTick: { users: defineRule(tickerBase, recordTick, user) },
    recordBeat: { users: defineRule(tickerBase, recordBeat, user) },
    fire: { users: defineRule(tickerBase, fire, user) },
    armTimer: { users: defineRule(tickerBase, armTimer, user) },
    armBackendTimer: { users: defineRule(tickerBase, armBackendTimer, user) },
    disarm: { users: defineRule(tickerBase, disarm, user) },
    escalate: { users: defineRule(tickerBase, escalate, user) },
    escalateChosen: { users: defineRule(tickerBase, escalateChosen, user) },
    escalateFailing: { users: defineRule(tickerBase, escalateFailing, user) },
    escalateLater: { users: defineRule(tickerBase, escalateLater, user) },
    escalateShortLived: { users: defineRule(tickerBase, escalateShortLived, user) },
    recordBeatShortLived: { users: defineRule(tickerBase, recordBeatShortLived, user) },
    invokeUp: { users: defineRule(tickerBase, invokeUp, user) },
    invokeUpAsSystem: { users: defineRule(tickerBase, invokeUpAsSystem, user) },
    reachDown: { users: defineRule(tickerBase, reachDown, user) },
  },
  schedules: { everyTenant, everyBackend },
});
interface Ticker extends ModuleType<typeof tickerDef> {}
/** The ticker module: two schedules, a timer and the commands that cross from a tenant to its backend. */
export const ticker: Ticker = tickerDef;
