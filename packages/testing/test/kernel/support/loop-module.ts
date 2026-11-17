import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineProcess,
  defineReaction,
  defineRule,
  deriveEffectId,
  type EntityType,
  enqueue,
  field,
  type Id,
  invoke,
  type ModuleBaseType,
  type ModuleType,
  outcomeOf,
  setTimer,
  settle,
  shape,
} from '@keelwerk/core';
import type { RelayApp } from './relay-app.ts';
import { relay } from './relay-module.ts';

/**
 * Two apps whose asynchronous reactions feed themselves, for the depth bound of 7.7. `loop`: a
 * `beat` makes a `pulse` and a `pulse` makes a `beat`, by one of eight ways (`via`): a plain write, an
 * inline reaction, a nested `invoke`, an `enqueue`, a timer, a process manager, an external effect
 * the reaction settles itself (`settle`) or one whose deadline passes (`deadline`): in both the
 * continuation writes the next beat. `selfloop`: one
 * reaction to every event that writes an event of its own.
 */
const beatDef = defineEntity({
  prefix: 'lbt',
  fields: { via: field.string({ maxLength: 20 }), n: field.integer() },
});
interface Beat extends EntityType<typeof beatDef> {}
const beat: Beat = beatDef;

const pulseDef = defineEntity({
  prefix: 'lpl',
  fields: { via: field.string({ maxLength: 20 }), n: field.integer() },
});
interface Pulse extends EntityType<typeof pulseDef> {}
const pulse: Pulse = pulseDef;

const loopBaseDef = defineModuleBase({
  id: 'loop',
  version: '0.1.0',
  entities: { beat, pulse },
});
interface LoopBase extends ModuleBaseType<typeof loopBaseDef> {}
const loopBase: LoopBase = loopBaseDef;

/** The members of `beat` and `pulse` an event of either carries. */
interface Step {
  readonly via: string;
  readonly n: number;
}
const stepOf = (event: { readonly data: unknown }): Step =>
  (event.data as { readonly values: Step }).values;

/** The decision context the reactions write through, typed as little as the other test modules do. */
interface WriteContext {
  readonly write: {
    readonly loop: {
      readonly beat: { create: (values: never) => unknown };
      readonly pulse: { create: (values: never) => unknown };
    };
  };
}
const writeOf = (ctx: unknown): WriteContext['write']['loop'] => (ctx as WriteContext).write.loop;

/** Starts a chain: a beat at 0, written by a caller, so its event has depth 0. */
const start = defineCommand(loopBase, {
  input: shape({ via: field.string() }),
  output: shape({}),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(beat);
    return [ctx.write.loop.beat.create({ id, via: input.via, n: 0 })];
  },
});

/** Writes a pulse: what the `invoke`, `enqueue` and `timer` ways of the first reaction run. */
const emitPulse = defineCommand(loopBase, {
  input: shape({ via: field.string(), n: field.integer() }),
  output: shape({}),
  principal: ['user', 'service'],
  *decide(input, ctx) {
    const id = yield* ctx.newId(pulse);
    return [ctx.write.loop.pulse.create({ id, via: input.via, n: input.n })];
  },
});

/** Writes a beat: what the process way runs. */
const emitBeat = defineCommand(loopBase, {
  input: shape({ via: field.string(), n: field.integer() }),
  output: shape({}),
  principal: ['user', 'service'],
  *decide(input, ctx) {
    const id = yield* ctx.newId(beat);
    return [ctx.write.loop.beat.create({ id, via: input.via, n: input.n })];
  },
});

/** An external effect nobody performs: a reaction settles it itself (`settle`) or lets its deadline pass (`deadline`). */
const probe = defineEffect(loopBase, {
  performer: 'external',
  input: shape({}),
  output: shape({}),
});

/** The continuation of the probe, whichever way it ended: writes the next beat, so the chain goes on through it. */
const resume = defineCommand(loopBase, {
  input: outcomeOf(probe, shape({ via: field.string(), n: field.integer() })),
  principal: 'service',
  *decide(input, ctx) {
    const id = yield* ctx.newId(beat);
    return [ctx.write.loop.beat.create({ id, via: input.via, n: input.n })];
  },
});

/** A beat makes the next pulse, the way its `via` says. */
const toPulse = defineReaction(loopBase, {
  on: 'loop.beat.created',
  *react(event, ctx) {
    const { via, n } = stepOf(event);
    const next = { via, n: n + 1 };
    switch (via) {
      case 'invoke':
        return { events: [], effects: [invoke(emitPulse, next)] };
      case 'enqueue':
        return { events: [], effects: [enqueue(emitPulse, next)] };
      case 'timer':
        return {
          events: [],
          effects: [
            setTimer({
              key: `pulse:${String(event.id)}`,
              after: '0s',
              invoke: emitPulse,
              input: next,
            }),
          ],
        };
      case 'settle': {
        // The probe is requested and settled in one decision, under the id the kernel derives for it from the job's command id.
        const effect = deriveEffectId(
          ctx.scope,
          `kernel:reaction:loop.toPulse:${event.id}`,
          0,
        ) as Id<'core.effect'>;
        return {
          events: [],
          effects: [
            probe({}, { continueWith: resume, with: next }),
            settle(effect, { ok: true, value: {} }),
          ],
        };
      }
      case 'deadline':
        return {
          events: [],
          effects: [
            probe(
              {},
              {
                continueWith: resume,
                with: next,
                deadline: ctx.clock.now().add({ seconds: 1 }),
              },
            ),
          ],
        };
      default: {
        const id = yield* ctx.newId(pulse);
        return [writeOf(ctx).pulse.create({ id, ...next } as never) as never];
      }
    }
  },
});

/** A pulse makes the next beat in an asynchronous reaction, unless the inline reaction or the process does. */
const toBeat = defineReaction(loopBase, {
  on: 'loop.pulse.created',
  *react(event, ctx) {
    const { via, n } = stepOf(event);
    if (via === 'inline' || via === 'process') return [];
    const id = yield* ctx.newId(beat);
    return [writeOf(ctx).beat.create({ id, via, n: n + 1 } as never) as never];
  },
});

/** The inline way: the beat is written in the command that wrote the pulse. */
const mirror = defineReaction(loopBase, {
  on: 'loop.pulse.created',
  timing: 'inline',
  *react(event, ctx) {
    const { via, n } = stepOf(event);
    if (via !== 'inline') return [];
    const id = yield* ctx.newId(beat);
    return [writeOf(ctx).beat.create({ id, via, n: n + 1 } as never) as never];
  },
});

/** The process way: the instance of each `via` turns, and enqueues the next beat. */
const cycle = defineProcess(loopBase, {
  on: ['loop.pulse.created'],
  key: (event) => stepOf(event as unknown as { readonly data: unknown }).via,
  events: { turned: shape({ n: field.integer() }) },
  initial: { turns: 0 },
  evolve: (state) => ({ turns: state.turns + 1 }),
  react: (event, _state, ctx) => {
    const { via, n } = stepOf(event as unknown as { readonly data: unknown });
    if (via !== 'process') return [];
    return {
      events: [ctx.events.turned({ n })],
      effects: [enqueue(emitBeat, { via, n: n + 1 })],
    };
  },
});

const user = { effect: 'allow', principal: 'user' } as const;
const loopDef = defineModule(loopBase, {
  actions: { start, emitPulse, emitBeat, resume },
  effects: { probe },
  policies: {
    start: { users: defineRule(loopBase, start, user) },
    emitPulse: { users: defineRule(loopBase, emitPulse, user) },
    emitBeat: { users: defineRule(loopBase, emitBeat, user) },
  },
  reactions: { toPulse, toBeat, mirror, cycle },
});
interface Loop extends ModuleType<typeof loopDef> {}
const loop: Loop = loopDef;

const loopAppDef = defineApp({ id: 'loopapp', modules: [loop] as const });
/** The eight-way loop app, with the type of the relay app: the reactions kit takes it as it takes a variant. */
const loopApp: RelayApp = loopAppDef as unknown as RelayApp;

const loopRelayAppDef = defineApp({ id: 'looprelayapp', modules: [loop, relay] as const });

/** The eight-way loop and the relay module in one app: one runtime holds both the plain process `loop.cycle` and the subject process `relay.tally`. */
const loopRelayApp: RelayApp = loopRelayAppDef as unknown as RelayApp;

const tickDef = defineEntity({ prefix: 'stk', fields: { n: field.integer() } });
interface Tick extends EntityType<typeof tickDef> {}
const tick: Tick = tickDef;

const selfBaseDef = defineModuleBase({
  id: 'selfloop',
  version: '0.1.0',
  observes: 'all',
  entities: { tick },
});
interface SelfBase extends ModuleBaseType<typeof selfBaseDef> {}
const selfBase: SelfBase = selfBaseDef;

/** Writes the first tick, with depth 0. */
const selfStart = defineCommand(selfBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(tick);
    return [ctx.write.selfloop.tick.create({ id, n: 0 })];
  },
});

/** Answers every event, its own ticks included, with a tick: nothing but the depth bound ends it. */
const echoEveryEvent = defineReaction(selfBase, {
  on: 'all',
  *react(_event, ctx) {
    const id = yield* ctx.newId(tick);
    const write = (
      ctx as unknown as { write: { selfloop: { tick: { create: (v: never) => unknown } } } }
    ).write;
    return [write.selfloop.tick.create({ id, n: 0 } as never) as never];
  },
});

const selfDef = defineModule(selfBase, {
  actions: { start: selfStart },
  policies: { start: { users: defineRule(selfBase, selfStart, user) } },
  reactions: { echoEveryEvent },
});
interface SelfLoop extends ModuleType<typeof selfDef> {}
const selfLoop: SelfLoop = selfDef;

const selfLoopAppDef = defineApp({ id: 'selfloopapp', modules: [selfLoop] as const });

/** The self-feeding app: one reaction to every event that writes a tick, with the type of the relay app. */
const selfLoopApp: RelayApp = selfLoopAppDef as unknown as RelayApp;

export { loopApp, loopRelayApp, selfLoopApp };
