import type { AppType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEffect,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';

const pingBase = defineModuleBase({ id: 'ping', version: '0.1.0' });

/** An external effect whose `to` member is personal, under the subject the effect names. */
const deliver = defineEffect(pingBase, {
  performer: 'external',
  input: shape({ ownerId: field.subject(), to: field.string().personal() }),
  dataSubject: 'ownerId',
});

/**
 * A command that writes no row and only requests the effect: its decision holds no entity event.
 */
const send = defineCommand(pingBase, {
  input: shape({ ownerId: field.subject(), to: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({ effects: [deliver({ ownerId: input.ownerId, to: input.to })], result: {} }),
});

const pingDef = defineModule(pingBase, {
  actions: { send },
  effects: { deliver },
  policies: {
    send: { signedIn: defineRule(pingBase, send, { effect: 'allow', principal: 'user' }) },
  },
});
const pingAppDef = defineApp({ id: 'ping', modules: [pingDef] });

/**
 * The test-local `ping` app: one command that requests a personal effect and writes nothing else.
 */
export interface PingApp extends AppType<typeof pingAppDef> {}
export const pingApp: PingApp = pingAppDef;
