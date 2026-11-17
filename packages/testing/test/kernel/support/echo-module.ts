import {
  cancelTimer,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  type EntityType,
  enqueue,
  field,
  type ModuleBaseType,
  type ModuleType,
  setTimer,
  shape,
} from '@keelwerk/core';

/** What echo's timer writes: one row per firing. */
const tickDef = defineEntity({ prefix: 'ech', fields: { at: field.string({ maxLength: 40 }) } });
interface EchoTick extends EntityType<typeof tickDef> {}
const tick: EchoTick = tickDef;

const echoBaseDef = defineModuleBase({ id: 'echo', version: '0.1.0', entities: { tick } });
interface EchoBase extends ModuleBaseType<typeof echoBaseDef> {}
const echoBase: EchoBase = echoBaseDef;

/** What echo's timer fires: an `echo.tick` row. */
const fire = defineCommand(echoBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  *decide(input, ctx) {
    const id = yield* ctx.newId(tick);
    return [ctx.write.echo.tick.create({ id, at: input.at })];
  },
});

/**
 * Sets echo's keyed timer 'pulse', the key ticker's own timer has, firing `fire` after 45 seconds.
 */
const armTimer = defineCommand(echoBase, {
  input: shape({ at: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [setTimer({ key: 'pulse', after: '45s', invoke: fire, input: { at: input.at } })],
  }),
});

/** Cancels echo's keyed timer 'pulse'. */
const disarm = defineCommand(echoBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  decide: () => ({ events: [], effects: [cancelTimer('pulse')] }),
});

/** Enqueues echo's `fire` for later under the key 'later', the key ticker's `escalateLater` has. */
const enqueueLater = defineCommand(echoBase, {
  input: shape({ at: field.string(), runAt: field.string() }),
  output: shape({}),
  principal: 'user',
  decide: (input) => ({
    events: [],
    effects: [
      enqueue(fire, { at: input.at }, { runAt: Temporal.Instant.from(input.runAt), key: 'later' }),
    ],
  }),
});

const user = { effect: 'allow', principal: 'user' } as const;
const echoDef = defineModule(echoBase, {
  actions: { fire, armTimer, disarm, enqueueLater },
  policies: {
    fire: { users: defineRule(echoBase, fire, user) },
    armTimer: { users: defineRule(echoBase, armTimer, user) },
    disarm: { users: defineRule(echoBase, disarm, user) },
    enqueueLater: { users: defineRule(echoBase, enqueueLater, user) },
  },
});
interface Echo extends ModuleType<typeof echoDef> {}
/**
 * The echo module: a timer under the key 'pulse' beside ticker's, to prove the two are apart, and a
 * keyed enqueue under 'later' beside ticker's `escalateLater`.
 */
export const echo: Echo = echoDef;
