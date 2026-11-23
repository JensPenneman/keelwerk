import {
  contracts,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  enqueue,
  field,
  mapItems,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const note = defineEntity({ prefix: 'flw', fields: { text: field.string({ maxLength: 80 }) } });
const flowBase = defineModuleBase({
  id: 'flow',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { note },
});

/** A write. */
const add = defineCommand(flowBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ id: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return { events: [ctx.write.flow.note.create({ id, text: input.text })], result: { id } };
  },
});

/** A job that does nothing; `later` enqueues it for an hour ahead. */
const work = defineCommand(flowBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  execution: 'async',
  decide() {
    return { events: [], result: {} };
  },
});

/** A command that enqueues a job: a test keeps it inside its unit at that enqueue. */
const later = defineCommand(flowBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  decide(_input, ctx) {
    return {
      events: [],
      effects: [enqueue(work, {}, { runAt: ctx.clock.now().add({ hours: 1 }) })],
      result: {},
    };
  },
});

/** A subscription whose input is checked after `admit`: a bad one fails the setup. */
const notes = defineSubscription(flowBase, {
  event: shape({ type: field.string(), noteId: field.string() }),
  input: shape({ page: field.integer() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('flow', 'note', { from: 'beginning', after: resume }), (change) => ({
      type: change.type,
      noteId: change.id,
    })),
});

const user = { effect: 'allow', principal: 'user' } as const;
const flow = defineModule(flowBase, {
  actions: { add, work, later, notes },
  policies: {
    add: { open: defineRule(flowBase, add, user) },
    work: { open: defineRule(flowBase, work, user) },
    later: { open: defineRule(flowBase, later, user) },
    notes: { open: defineRule(flowBase, notes, user) },
    note: {
      readers: defineRule(flowBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
      }),
    },
  },
});

/**
 * The app of the cases of the limits across the deployment: a write, a command held at its enqueue,
 * and a live subscription.
 */
export const concurrencyApp = defineApp({ id: 'flow-app', modules: [live, flow] });
