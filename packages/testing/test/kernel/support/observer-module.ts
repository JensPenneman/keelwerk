import {
  defineEntity,
  defineModule,
  defineModuleBase,
  defineReaction,
  defineRule,
  type EntityType,
  field,
  type ModuleBaseType,
  type ModuleType,
} from '@keelwerk/core';
import { relay } from './relay-module.ts';

/** The type of every event the observer was given, one row each. */
const seenEventDef = defineEntity({
  prefix: 'obs',
  fields: { type: field.string({ maxLength: 120 }), stream: field.string({ maxLength: 120 }) },
});
interface SeenEvent extends EntityType<typeof seenEventDef> {}
const seenEvent: SeenEvent = seenEventDef;

const observerBaseDef = defineModuleBase({
  id: 'observer',
  version: '0.1.0',
  requires: [relay],
  observes: 'all',
  entities: { seenEvent },
});
interface ObserverBase extends ModuleBaseType<typeof observerBaseDef> {}
const observerBase: ObserverBase = observerBaseDef;

/** An asynchronous reaction to every event (S-136) but the rows it writes itself. */
const observeAll = defineReaction(observerBase, {
  on: 'all',
  except: ['observer.seenEvent.created'],
  *react(event, ctx) {
    const id = yield* ctx.newId(seenEvent);
    const write = (ctx as { write: { observer: { seenEvent: { create: (v: never) => unknown } } } })
      .write;
    return [
      write.observer.seenEvent.create({
        id,
        type: event.type,
        stream: event.stream.type,
      } as never) as never,
    ];
  },
});

const observerDef = defineModule(observerBase, {
  policies: {
    seenEvent: {
      readers: defineRule(observerBase, seenEvent, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads what the observer saw.',
      }),
    },
  },
  reactions: { observeAll },
});
interface Observer extends ModuleType<typeof observerDef> {}
/** A module that observes all events and records the type and stream type of each one it is given. */
export const observer: Observer = observerDef;
