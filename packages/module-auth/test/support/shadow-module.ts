import {
  cancelTimer,
  defineCommand,
  defineModule,
  defineModuleBase,
  enqueue,
  field,
  setTimer,
  shape,
} from '@keelwerk/core';
import { sessionExtensionKey } from '../../src/lib/session-extension-key.ts';

const shadowBaseDef = defineModuleBase({ id: 'shadow', version: '0.0.0' });

/** What the shadow's own job does: nothing. */
const idle = defineCommand(shadowBaseDef, {
  input: shape({}),
  auth: { public: true },
  execution: 'sync',
  decide: () => [],
});

/**
 * Enqueues the shadow's own idle job under the very key text auth uses for the extension of a
 * session, `sessionExtensionKey(sessionId)`, to run `afterMinutes` from now.
 */
const hold = defineCommand(shadowBaseDef, {
  input: shape({ sessionId: field.string(), afterMinutes: field.integer() }),
  output: shape({ queued: field.boolean() }),
  auth: { public: true },
  execution: 'sync',
  decide: (input, ctx) => ({
    events: [],
    effects: [
      enqueue(
        idle,
        {},
        {
          key: sessionExtensionKey(input.sessionId),
          runAt: ctx.clock.now().add({ minutes: input.afterMinutes }),
        },
      ),
    ],
    result: { queued: true },
  }),
});

/** Sets a timer of the shadow's own, with the idle job, under the key text of a session's extension. */
const arm = defineCommand(shadowBaseDef, {
  input: shape({ sessionId: field.string() }),
  output: shape({ armed: field.boolean() }),
  auth: { public: true },
  execution: 'sync',
  decide: (input, ctx) => ({
    events: [],
    effects: [
      setTimer({
        key: sessionExtensionKey(input.sessionId),
        invoke: idle,
        input: {},
        at: ctx.clock.now().add({ hours: 24 }),
      }),
    ],
    result: { armed: true },
  }),
});

/** Cancels the timer of the shadow's own that is under the key text of a session's extension. */
const cancel = defineCommand(shadowBaseDef, {
  input: shape({ sessionId: field.string() }),
  output: shape({ cancelled: field.boolean() }),
  auth: { public: true },
  execution: 'sync',
  decide: (input) => ({
    events: [],
    effects: [cancelTimer(sessionExtensionKey(input.sessionId))],
    result: { cancelled: true },
  }),
});

const shadowDef = defineModule(shadowBaseDef, { actions: { idle, hold, arm, cancel } });

/**
 * A module that uses the key text of a session's idle extension for its own job, timer and cancel,
 * for tests.
 */
export const shadowModule: typeof shadowDef = shadowDef;
