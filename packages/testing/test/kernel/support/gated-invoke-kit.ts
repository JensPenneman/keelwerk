import {
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineReaction,
  defineRule,
  field,
  invoke,
  shape,
} from '@keelwerk/core';

const item = defineEntity({ prefix: 'itm', fields: { text: field.string({ maxLength: 80 }) } });
const mark = defineEntity({ prefix: 'mrk', fields: { text: field.string({ maxLength: 80 }) } });
const ping = defineEntity({ prefix: 'png', fields: { text: field.string({ maxLength: 80 }) } });
const pipesBase = defineModuleBase({
  id: 'pipes',
  version: '0.1.0',
  entities: { item, mark, ping },
  flags: {
    open: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});

/** The action behind the gate: it writes a mark, so a refusal leaves no event. */
const target = defineCommand(pipesBase, {
  gate: 'open',
  input: shape({}),
  output: shape({ ran: field.boolean() }),
  principal: 'user',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(mark);
    return {
      events: [ctx.write.pipes.mark.create({ id, text: 'target' })],
      result: { ran: true },
    };
  },
});
/** Returns an invoke effect for the gated action. */
const relay = defineCommand(pipesBase, {
  input: shape({}),
  output: shape({ relayed: field.boolean() }),
  principal: 'user',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(ping);
    return {
      events: [ctx.write.pipes.ping.create({ id, text: 'relay' })],
      effects: [invoke(target, {})],
      result: { relayed: true },
    };
  },
});
/** Writes an item; the inline reaction below invokes the gated action. */
const put = defineCommand(pipesBase, {
  input: shape({}),
  output: shape({ put: field.boolean() }),
  principal: 'user',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(item);
    return {
      events: [ctx.write.pipes.item.create({ id, text: 'put' })],
      result: { put: true },
    };
  },
});
const onItem = defineReaction(pipesBase, {
  on: 'pipes.item.created',
  timing: 'inline',
  react: () => ({ events: [], effects: [invoke(target, {})] }),
});
const pipes = defineModule(pipesBase, {
  actions: { target, relay, put },
  reactions: { onItem },
  policies: {
    target: { open: defineRule(pipesBase, target, { effect: 'allow', principal: 'user' }) },
    relay: { open: defineRule(pipesBase, relay, { effect: 'allow', principal: 'user' }) },
    put: { open: defineRule(pipesBase, put, { effect: 'allow', principal: 'user' }) },
  },
});

const app = defineApp({ id: 'gated-invoke-app', modules: [pipes] as const });

export const gatedInvokeApp: typeof app = app;
