import type { AppType, ModuleType } from '@keelwerk/core';
import {
  core,
  defineApp,
  defineCommand,
  defineEffect,
  defineError,
  defineModule,
  defineRule,
  errors,
  field,
  sameSubject,
  setTimer,
  shape,
  within,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  probeBase,
  probePerson,
  probeSession,
  probeThread,
  probeToCore,
} from './erasure-probe-base.ts';
import {
  doomed,
  notice,
  noticeExecutor,
  notify,
  proofRules,
  refuse,
  remind,
} from './erasure-probe-proof.ts';
import { arrive, note, requestRules, stampThread } from './erasure-probe-request.ts';
import { relay } from './relay-module.ts';

const person = probePerson;
const thread = probeThread;
const session = probeSession;
const toCore = probeToCore;

/** A declared error whose data holds the address: the live answer keeps it, storage must not. */
const emailTaken = defineError('probe.email_taken', {
  kind: 'conflict',
  message: 'That address is taken.',
  data: shape({ email: field.string() }),
});

/** Delivering to an address: its input is sealed under the thread owner's key. */
const deliver = defineEffect(probeBase, {
  performer: 'external',
  input: shape({ threadId: field.ref.own('thread'), to: field.string().personal() }),
  dataSubject: 'threadId.ownerId',
});

const enrol = defineCommand(probeBase, {
  input: shape({
    name: field.string({ maxLength: 100 }),
    email: field.string({ format: 'email' }),
    notes: field.string().optional(),
    vip: field.boolean().optional(),
    token: field.secret().optional(),
  }),
  output: shape({ personId: field.ref.own('person') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(person);
    return {
      events: [
        ctx.write.probe.person.create({
          id,
          name: input.name,
          email: input.email,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.vip === undefined ? {} : { vip: input.vip }),
          ...(input.token === undefined ? {} : { token: input.token }),
        }),
      ],
      result: { personId: id },
    };
  },
});

const open = defineCommand(probeBase, {
  input: shape({
    ownerId: field.subject(),
    title: field.string({ maxLength: 100 }),
    topic: field.string().optional(),
  }),
  output: shape({ threadId: field.ref.own('thread') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(thread);
    return {
      events: [
        ctx.write.probe.thread.create({
          id,
          ownerId: input.ownerId,
          title: input.title,
          ...(input.topic === undefined ? {} : { topic: input.topic }),
        }),
      ],
      result: { threadId: id },
    };
  },
});

/** Signs a subject in: the session row it owns, whose id is the principal id of the subject's requests. */
const signIn = defineCommand(probeBase, {
  input: shape({ ownerId: field.subject() }),
  output: shape({ sessionId: field.ref.own('session') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(session);
    return {
      events: [ctx.write.probe.session.create({ id, ownerId: input.ownerId, kind: 'browser' })],
      result: { sessionId: id },
    };
  },
});

const answer = defineCommand(probeBase, {
  input: shape({
    threadId: field.ref.own('thread'),
    replierId: field.subject(),
    reply: field.string(),
  }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.probe.thread.one({ where: { id: input.threadId } });
    if (row === undefined) return [];
    return [ctx.write.probe.thread.update(row, { replierId: input.replierId, reply: input.reply })];
  },
});

/** Appends a personal tag to the notes of a thread. */
const jot = defineCommand(probeBase, {
  input: shape({
    threadId: field.ref.own('thread'),
    tag: field.string().personal({ subject: 'threadId.ownerId' }),
  }),
  principal: 'operator',
  decide: (input, ctx) => ({
    events: [ctx.write.probe.notes.append(input.threadId, [{ n: 1, tags: [input.tag] }])],
  }),
});

/** Always refuses with the declared error, which carries the address. */
const claim = defineCommand(probeBase, {
  input: shape({
    ownerId: field.subject(),
    email: field.string().personal({ subject: 'ownerId' }),
  }),
  errors: [emailTaken],
  principal: 'operator',
  decide: (input) => {
    throw emailTaken({ email: input.email });
  },
});

/** An asynchronous command with a personal input member: its job row seals the member. */
const subscribe = defineCommand(probeBase, {
  execution: 'async',
  input: shape({
    address: field.string().personal({ subject: 'ownerId' }),
    ownerId: field.subject(),
  }),
  principal: 'operator',
  decide: () => ({}),
});

/**
 * An asynchronous command that always fails with a retryable error: its job stays in the queue,
 * waiting for its next attempt, with the personal member sealed in its input.
 */
const defer = defineCommand(probeBase, {
  execution: 'async',
  input: shape({
    address: field.string().personal({ subject: 'ownerId' }),
    ownerId: field.subject(),
  }),
  principal: 'operator',
  decide: () => {
    throw errors.unavailable('The destination is not reachable yet.');
  },
});

/** Sets a timer that appends a neutral tag to the notes of a thread later. */
const arm = defineCommand(probeBase, {
  input: shape({ threadId: field.ref.own('thread') }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      setTimer({
        key: 'probe-arm',
        after: '1h',
        invoke: jot,
        input: { threadId: input.threadId, tag: 'neutral' },
      }),
    ],
  }),
});

/** Times a command with a personal input member: the timer seals it under the subject's key. */
const armPersonal = defineCommand(probeBase, {
  input: shape({
    ownerId: field.subject(),
    address: field.string().personal({ subject: 'ownerId' }),
  }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      setTimer({
        key: 'probe-arm-personal',
        after: '1h',
        invoke: defer,
        input: { ownerId: input.ownerId, address: input.address },
      }),
    ],
  }),
});

/** Requests a delivery to an address: the effect input is sealed. */
const send = defineCommand(probeBase, {
  input: shape({ threadId: field.ref.own('thread'), to: field.string() }),
  principal: 'operator',
  decide: (input) => ({ effects: [deliver({ threadId: input.threadId, to: input.to })] }),
});

/**
 * The thread owner's session asks for a delivery that must be answered by a time: the effect keeps
 * the session as its submitter, and an outside performer's effect with a deadline has a deadline job.
 */
const reachOut = defineCommand(probeBase, {
  input: shape({
    threadId: field.ref.own('thread'),
    to: field.string(),
    deadline: field.instant(),
  }),
  principal: 'user',
  decide: (input) => ({
    effects: [deliver({ threadId: input.threadId, to: input.to }, { deadline: input.deadline })],
  }),
});

/**
 * The rule the probe contributes to the core's action: a user may erase their own subject. The
 * probe holds rows of subjects (a person, a thread's owner), so the contribution grants an erasure
 * of those subjects only (`checkErasureGrant`).
 */
const selfErase = defineRule(within(probeBase, toCore), core.actions.eraseSubject, {
  effect: 'allow',
  principal: 'user',
  when: (context, input) =>
    sameSubject(
      context.principal.subject,
      String((input as { readonly subjectId?: unknown }).subjectId),
    ),
  reason: 'A user erases their own subject.',
});

const rules = {
  enrol: defineRule(probeBase, enrol, { effect: 'allow', principal: 'operator' }),
  open: defineRule(probeBase, open, { effect: 'allow', principal: 'operator' }),
  signIn: defineRule(probeBase, signIn, { effect: 'allow', principal: 'operator' }),
  answer: defineRule(probeBase, answer, { effect: 'allow', principal: 'operator' }),
  jot: defineRule(probeBase, jot, { effect: 'allow', principal: 'operator' }),
  claim: defineRule(probeBase, claim, { effect: 'allow', principal: 'operator' }),
  subscribe: defineRule(probeBase, subscribe, { effect: 'allow', principal: 'operator' }),
  defer: defineRule(probeBase, defer, { effect: 'allow', principal: 'operator' }),
  arm: defineRule(probeBase, arm, { effect: 'allow', principal: 'operator' }),
  armPersonal: defineRule(probeBase, armPersonal, { effect: 'allow', principal: 'operator' }),
  send: defineRule(probeBase, send, { effect: 'allow', principal: 'operator' }),
  reachOut: defineRule(probeBase, reachOut, { effect: 'allow', principal: 'user' }),
  // The generated update and set of a person: a client writes the personal fields through them.
  editPerson: defineRule(probeBase, person, {
    effect: 'allow',
    actions: ['update', 'set'],
    principal: 'operator',
    reason: 'An operator edits a person through the generated update and set.',
  }),
};

const probeDef = defineModule(probeBase, {
  actions: {
    enrol,
    open,
    signIn,
    arrive,
    note,
    stampThread,
    answer,
    jot,
    claim,
    subscribe,
    defer,
    arm,
    armPersonal,
    send,
    reachOut,
    notify,
    remind,
  },
  effects: { deliver, notice },
  executors: { notice: noticeExecutor },
  reactions: { refuse, doomed },
  contributes: { toCore: { policies: { eraseSubject: { selfErase } } } },
  policies: {
    enrol: { operators: rules.enrol },
    open: { operators: rules.open },
    signIn: { operators: rules.signIn },
    arrive: { anonymous: requestRules.arrive },
    note: { users: requestRules.note },
    stampThread: { operators: requestRules.stampThread },
    answer: { operators: rules.answer },
    jot: { operators: rules.jot },
    claim: { operators: rules.claim },
    subscribe: { operators: rules.subscribe },
    defer: { operators: rules.defer },
    arm: { operators: rules.arm },
    armPersonal: { operators: rules.armPersonal },
    send: { operators: rules.send },
    reachOut: { users: rules.reachOut },
    notify: { operators: proofRules.notify },
    remind: { operators: proofRules.remind },
    person: { operators: rules.editPerson },
  },
});
interface Probe extends ModuleType<typeof probeDef> {}
const probe: Probe = probeDef;

const probeAppDef = defineApp({
  id: 'erasure-probe',
  modules: [probe, relay, live] as const,
});
interface ProbeApp extends AppType<typeof probeAppDef> {}

/**
 * An app of personal data planted through the paths an erasure must reach: sealed columns and
 * tags, another subject's value on a row, a personal list element in a stream, a declared error
 * with the address, an asynchronous command with a personal member, a sealed effect input, an
 * effect with an output and a refusal, a reaction that ends as a dead letter, the relay's process
 * with personal members, a stream ticket and a flag rule that names the subject.
 */
export const erasureDumpApp: ProbeApp = probeAppDef;

/** The probe module, for the apps of the grant tests. */
export { probe as erasureProbe };
