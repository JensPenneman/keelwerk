import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineReaction,
  defineRule,
  errors,
  field,
  setTimer,
  shape,
} from '@keelwerk/core';
import { erasureProbe } from './erasure-probe-module.ts';

/** What the queues module reports to a test: what its reaction saw and how often its executor ran. */
const queuesControl: {
  /** `JSON.stringify` of what each attempt of the reaction received, in order. */
  readonly seen: string[];
  /** How many times the executor of the effect ran. */
  executed: number;
  /** The command that decided, in order, by action. */
  readonly decided: string[];
} = { seen: [], executed: 0, decided: [] };

const ticketDef = defineEntity({
  prefix: 'qtk',
  dataSubject: 'ownerId',
  fields: {
    ownerId: field.subject().index(),
    topic: field.string().optional().personal(),
  },
});
interface Ticket extends EntityType<typeof ticketDef> {}
const ticket: Ticket = ticketDef;

const queuesBaseDef = defineModuleBase({
  id: 'queues',
  version: '0.1.0',
  entities: { ticket },
});
interface QueuesBase extends ModuleBaseType<typeof queuesBaseDef> {}
const queuesBase: QueuesBase = queuesBaseDef;

/** Delivering to an address: an executor that is never reachable, so the effect job waits for its retry. */
const notify = defineEffect(queuesBase, {
  input: shape({ ticketId: field.ref.own('ticket'), to: field.string().personal() }),
  dataSubject: 'ticketId.ownerId',
});

const notifyExecutor = defineEffectExecutor(queuesBase, notify, {
  queue: 'queues-mail',
  retry: { delays: ['1h'] },
  run: () => {
    queuesControl.executed += 1;
    return Promise.reject(errors.unavailable('The destination is not reachable yet.'));
  },
});

const open = defineCommand(queuesBase, {
  input: shape({ ownerId: field.subject(), topic: field.string() }),
  output: shape({ ticketId: field.ref.own('ticket') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(ticket);
    return {
      events: [ctx.write.queues.ticket.create({ id, ownerId: input.ownerId, topic: input.topic })],
      result: { ticketId: id },
    };
  },
});

/** Requests a delivery to an address: the effect input is sealed under the owner's key, its job waits. */
const send = defineCommand(queuesBase, {
  input: shape({ ticketId: field.ref.own('ticket'), to: field.string() }),
  principal: 'operator',
  decide: (input) => ({ effects: [notify({ ticketId: input.ticketId, to: input.to })] }),
});

/** Requests a delivery that waits for `at`: its job is not taken before then, so its executor has not run yet. */
const sendAt = defineCommand(queuesBase, {
  input: shape({ ticketId: field.ref.own('ticket'), to: field.string(), at: field.instant() }),
  principal: 'operator',
  decide: (input) => ({
    effects: [notify({ ticketId: input.ticketId, to: input.to }, { runAt: input.at })],
  }),
});

/** An asynchronous command with a secret: its job holds the secret under a value key of the job. */
const stash = defineCommand(queuesBase, {
  execution: 'async',
  input: shape({ note: field.secret() }),
  principal: ['user', 'operator'],
  decide: () => {
    throw errors.unavailable('The store is not reachable yet.');
  },
});

/** A command that waits for its next attempt, with a personal member sealed under the owner's key. */
const hold = defineCommand(queuesBase, {
  execution: 'async',
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
  }),
  principal: ['operator', 'service'],
  decide: () => {
    queuesControl.decided.push('queues.hold');
    throw errors.unavailable('The destination is not reachable yet.');
  },
});

/** A command that runs, with a personal member. */
const accept = defineCommand(queuesBase, {
  execution: 'async',
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
  }),
  principal: ['operator', 'service'],
  decide: () => {
    queuesControl.decided.push('queues.accept');
    return {};
  },
});

/** Times `hold` or `accept` for an address of a subject. */
const arm = defineCommand(queuesBase, {
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
    runs: field.boolean(),
  }),
  principal: ['operator', 'user'],
  decide: (input) => ({
    effects: [
      setTimer({
        key: 'queues-arm',
        after: '1h',
        invoke: input.runs ? accept : hold,
        input: { ownerId: input.ownerId, address: input.address },
      }),
    ],
  }),
});

/** Looks at the ticket of an event: fails on its first attempt, and sees what the ticket holds at the second. */
const peek = defineReaction(queuesBase, {
  on: 'queues.ticket.created',
  retry: { limit: 5, delays: ['1h'] },
  react: (event) => {
    queuesControl.seen.push(JSON.stringify({ data: event.data, current: event.current ?? null }));
    if (queuesControl.seen.length === 1) throw errors.unavailable('Not yet.');
    return [];
  },
});

const queuesDef = defineModule(queuesBase, {
  actions: { open, send, sendAt, stash, hold, accept, arm },
  effects: { notify },
  executors: { notify: notifyExecutor },
  reactions: { peek },
  policies: {
    open: { operators: defineRule(queuesBase, open, { effect: 'allow', principal: 'operator' }) },
    send: { operators: defineRule(queuesBase, send, { effect: 'allow', principal: 'operator' }) },
    sendAt: {
      operators: defineRule(queuesBase, sendAt, { effect: 'allow', principal: 'operator' }),
    },
    stash: {
      everyone: defineRule(queuesBase, stash, { effect: 'allow', principal: ['user', 'operator'] }),
    },
    hold: {
      operators: defineRule(queuesBase, hold, {
        effect: 'allow',
        principal: ['operator', 'service'],
      }),
    },
    accept: {
      operators: defineRule(queuesBase, accept, { effect: 'allow', principal: 'operator' }),
    },
    arm: {
      everyone: defineRule(queuesBase, arm, { effect: 'allow', principal: ['operator', 'user'] }),
    },
  },
});
interface Queues extends ModuleType<typeof queuesDef> {}
const queues: Queues = queuesDef;

const queuesAppDef = defineApp({ id: 'erasure-queues', modules: [erasureProbe, queues] as const });
interface QueuesApp extends AppType<typeof queuesAppDef> {}

/** The probe app and a module with a job on every queue that stores an input: a timer, a command, an effect and a reaction. */
export const erasureQueuesApp: QueuesApp = queuesAppDef;

export { queuesControl };
