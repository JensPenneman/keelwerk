import {
  defineApp,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  field,
  type ModuleBaseType,
  type ModuleType,
  shape,
} from '@keelwerk/core';

interface ChoresBase extends ModuleBaseType<typeof choresBaseDef> {}
const choresBaseDef = defineModuleBase({ id: 'chores', version: '1.0.0' });
const choresBase: ChoresBase = choresBaseDef;

const oldPing = defineQuery(choresBase, {
  principal: 'user',
  output: shape({ pong: field.boolean() }),
  deprecated: { reason: 'Use ping.', at: '2026-11-05', sunset: '2026-12-01' },
  read: () => ({ pong: true }),
});

const quietPing = defineQuery(choresBase, {
  principal: 'user',
  output: shape({ pong: field.boolean() }),
  deprecated: { reason: 'Use ping.', sunset: '2026-12-01' },
  read: () => ({ pong: true }),
});

const choresDef = defineModule(choresBase, {
  actions: { oldPing, quietPing },
  policies: {
    oldPing: { users: defineRule(choresBase, oldPing, { effect: 'allow', principal: 'user' }) },
    quietPing: { users: defineRule(choresBase, quietPing, { effect: 'allow', principal: 'user' }) },
  },
});
interface Chores extends ModuleType<typeof choresDef> {}
const chores: Chores = choresDef;

/** The day `chores.oldPing` is deprecated from; it is sunset on 2026-12-01. */
export const deprecationDay = '2026-11-05';

/** An app with two deprecated queries at its only (head) API version: `chores.oldPing` from a day, `chores.quietPing` without a date (sunset 2026-12-01). */
export const deprecatedPingApp = defineApp({ id: 'deprecated-ping', modules: [chores] });
