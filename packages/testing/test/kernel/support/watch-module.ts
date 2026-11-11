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

/** What a reaction of another module sees of the events of `relay.signal`, as an async reaction and as an inline one. */
const seenDef = defineEntity({
  prefix: 'rsn',
  fields: {
    kind: field.string({ maxLength: 10 }),
    keys: field.string({ maxLength: 400 }),
    data: field.string({ maxLength: 1000 }),
  },
});
interface Seen extends EntityType<typeof seenDef> {}
const seen: Seen = seenDef;

const watchBaseDef = defineModuleBase({
  id: 'watch',
  version: '0.1.0',
  requires: [relay],
  entities: { seen },
});
interface WatchBase extends ModuleBaseType<typeof watchBaseDef> {}
const watchBase: WatchBase = watchBaseDef;

function payloadView(data: unknown): unknown {
  const values = (data as { values?: Record<string, unknown> }).values ?? {};
  return {
    keys: Object.keys(values).sort(),
    contactLength: typeof values.contact === 'string' ? values.contact.length : null,
    internalNote: values.internalNote === undefined ? 'absent' : 'present',
  };
}

function seenDraft(
  ctx: unknown,
  id: string,
  kind: 'async' | 'inline',
  row: unknown,
  data: unknown,
): never {
  const write = (ctx as { write: { watch: { seen: { create: (v: never) => unknown } } } }).write;
  return write.watch.seen.create({
    id,
    kind,
    keys: JSON.stringify(Object.keys((row ?? {}) as object).sort()),
    // What the payload shows, never the values: the row is plain data, and `contact` is personal.
    data: JSON.stringify(payloadView(data)),
  } as never) as never;
}

const watchAsync = defineReaction(watchBase, {
  on: 'relay.signal.created',
  *react(event, ctx) {
    const id = yield* ctx.newId(seen);
    return [seenDraft(ctx, id, 'async', event.current, event.data)];
  },
});
const watchInline = defineReaction(watchBase, {
  on: 'relay.signal.created',
  timing: 'inline',
  *react(event, ctx) {
    const id = yield* ctx.newId(seen);
    return [seenDraft(ctx, id, 'inline', event.state, event.data)];
  },
});

const watchDef = defineModule(watchBase, {
  policies: {
    seen: {
      readers: defineRule(watchBase, seen, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads what was seen.',
      }),
    },
  },
  reactions: { watchAsync, watchInline },
});
interface Watch extends ModuleType<typeof watchDef> {}
/** A module that requires the relay and watches its signals, as an async and as an inline reaction. */
export const watch: Watch = watchDef;
