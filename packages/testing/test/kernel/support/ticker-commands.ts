import {
  cancelTimer,
  defineCommand,
  enqueue,
  field,
  invoke,
  setTimer,
  shape,
  system,
} from '@keelwerk/core';
import { beat, refused, tick, tickerBase } from './ticker-base.ts';
import { tickerControl } from './ticker-control.ts';

const tickInput = shape({
  schedule: field.string(),
  at: field.string(),
  token: field.secret().optional(),
});
const beatInput = shape({ source: field.string(), at: field.string() });

/** Writes a tick row in the tenant: what an each-tenant schedule or a timer runs. */
const recordTick = defineCommand(tickerBase, {
  input: tickInput,
  output: shape({}),
  *decide(input, ctx) {
    const id = yield* ctx.newId(tick);
    return [ctx.write.ticker.tick.create({ id, schedule: input.schedule, at: input.at })];
  },
});

/** Writes a beat row in the backend: what a backend schedule runs, and what a tenant reaches upward. */
const recordBeat = defineCommand(tickerBase, {
  scope: 'backend',
  input: beatInput,
  output: shape({}),
  errors: [refused],
  *decide(input, ctx) {
    if (tickerControl.refuse) throw refused();
    const id = yield* ctx.newId(beat);
    return [ctx.write.ticker.beat.create({ id, source: input.source, at: input.at })];
  },
});

/** A backend command whose receipts last only half a minute: its jobs from a tenant must hold longer than that. */
const recordBeatShortLived = defineCommand(tickerBase, {
  scope: 'backend',
  idempotency: { window: '30s' },
  input: beatInput,
  output: shape({}),
  *decide(input, ctx) {
    const id = yield* ctx.newId(beat);
    return [ctx.write.ticker.beat.create({ id, source: input.source, at: input.at })];
  },
});

/** What a timer fires: a tick row with the schedule name 'timer'. */
const fire = defineCommand(tickerBase, {
  input: tickInput,
  output: shape({}),
  *decide(input, ctx) {
    const id = yield* ctx.newId(tick);
    return [ctx.write.ticker.tick.create({ id, schedule: 'timer', at: input.at })];
  },
});

/** Sets the keyed timer 'pulse' that fires `fire` after 45 seconds. */
const armTimer = defineCommand(tickerBase, {
  input: shape({ at: field.string(), token: field.string().optional() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      setTimer({
        key: 'pulse',
        after: '45s',
        invoke: fire,
        input: {
          schedule: 'timer',
          at: input.at,
          ...(input.token === undefined ? {} : { token: input.token }),
        },
      }),
    ],
  }),
});

/** Sets the keyed timer 'pulse' on a backend command from a tenant command. */
const armBackendTimer = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      setTimer({
        key: 'pulse',
        after: '45s',
        invoke: recordBeat,
        input: { source: 'timer', at: input.at },
      }),
    ],
  }),
});

/** Cancels the keyed timer 'pulse'. */
const disarm = defineCommand(tickerBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  decide: () => ({ events: [], effects: [cancelTimer('pulse')] }),
});

/** Enqueues a backend command from a tenant command. */
const escalate = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [enqueue(recordBeat, { source: 'enqueue', at: input.at })],
  }),
});

/** Enqueues a backend command for later, under a key: the way delayed work crosses scopes, which a timer may not. */
const escalateLater = defineCommand(tickerBase, {
  input: shape({ at: field.string(), runAt: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      enqueue(
        recordBeat,
        { source: 'later', at: input.at },
        { runAt: Temporal.Instant.from(input.runAt), key: 'later' },
      ),
    ],
  }),
});

/** Enqueues the short-lived backend command from a tenant command. */
const escalateShortLived = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [enqueue(recordBeatShortLived, { source: 'short', at: input.at })],
  }),
});

/** Enqueues a backend command under a command id the tenant chose: refused, the backend's receipt would be shared by every tenant. */
const escalateChosen = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      enqueue(recordBeat, { source: 'enqueue', at: input.at }, { commandId: 'close-2026-11' }),
    ],
  }),
});

/** Enqueues a backend command, then asks for a command that does not exist: the decision fails and the job must not commit. */
const escalateFailing = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      enqueue(recordBeat, { source: 'enqueue', at: input.at }),
      enqueue('ticker.absent', {}),
    ],
  }),
});

/** Invokes a backend command from a tenant command. */
const invokeUp = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [invoke(recordBeat, { source: 'invoke', at: input.at })],
  }),
});

/** Invokes a backend command as the system principal: refused across scopes. */
const invokeUpAsSystem = defineCommand(tickerBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [invoke(recordBeat, { source: 'invoke', at: input.at }, { as: system('test') })],
  }),
});

/** A backend command that enqueues a tenant command: refused, a backend names no tenant. */
const reachDown = defineCommand(tickerBase, {
  scope: 'backend',
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [enqueue(recordTick, { schedule: 'down', at: input.at })],
  }),
});

export {
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
};
