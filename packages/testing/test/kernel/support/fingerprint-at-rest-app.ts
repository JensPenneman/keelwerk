import type { AppType, EntityType, ModuleBaseType, ModuleType, Scope } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEntity,
  defineError,
  defineModule,
  defineModuleBase,
  defineRule,
  enqueue,
  field,
  invoke,
  setTimer,
  shape,
} from '@keelwerk/core';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';

/**
 * A declared error: a command that refuses with it is pinned to its command id by a failed receipt.
 */
const wrongPassword = defineError('rest.wrong_password', {
  kind: 'conflict',
  message: 'The password is wrong.',
});

const itemDef = defineEntity({
  prefix: 'rst',
  dataSubject: 'id',
  fields: {
    name: field.string({ maxLength: 100 }),
    notes: field.string().optional().personal(),
    pin: field.secret().optional(),
  },
});
interface Item extends EntityType<typeof itemDef> {}
const item: Item = itemDef;

/**
 * Owned by `ownerId`; its `reply` is the personal value of another subject, `replierId`, so the
 * subject of the member is another member of the same input.
 */
const threadDef = defineEntity({
  prefix: 'rth',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    ownerId: field.subject(),
    replierId: field.subject().optional(),
    reply: field.string().optional().personal({ subject: 'replierId' }),
  },
});
interface Thread extends EntityType<typeof threadDef> {}
const thread: Thread = threadDef;

const baseDef = defineModuleBase({ id: 'rest', version: '0.1.0', entities: { item, thread } });
interface RestBase extends ModuleBaseType<typeof baseDef> {}
const restBase: RestBase = baseDef;

/** A command that takes a secret and a plain member. */
const sign = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }), password: field.secret() }),
  principal: 'operator',
  decide: () => ({}),
});

/** A command that writes a row: its decision record holds an input digest. */
const record = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }), password: field.secret() }),
  output: shape({ itemId: field.ref.own('item') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(item);
    return {
      events: [ctx.write.rest.item.create({ id, name: input.label })],
      result: { itemId: id },
    };
  },
});

/**
 * A command with a personal member of the data subject `subjectId` and a secret that writes a row
 * holding neither: a retry that changes either shows which one the receipt covers, and its event
 * holds no personal value.
 */
const register = defineCommand(restBase, {
  input: shape({
    subjectId: field.subject(),
    nickname: field.string({ maxLength: 40 }).personal({ subject: 'subjectId' }),
    password: field.secret(),
  }),
  output: shape({ itemId: field.ref.own('item') }),
  principal: 'operator',
  *decide(_input, ctx) {
    const id = yield* ctx.newId(item);
    return {
      events: [ctx.write.rest.item.create({ id, name: 'registered' })],
      result: { itemId: id },
    };
  },
});

/**
 * A command whose decision gives a row its first personal value: the key of the row's subject is
 * created by sealing in the unit of the write, and the event meta holds the rekeyed digest.
 */
const note = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }), notes: field.string() }),
  output: shape({ itemId: field.ref.own('item') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(item);
    return {
      events: [ctx.write.rest.item.create({ id, name: input.label, notes: input.notes })],
      result: { itemId: id },
    };
  },
});

/**
 * A command that always refuses and carries a personal member of the data subject `subjectId`: its
 * failed receipt is keyed.
 */
const refuse = defineCommand(restBase, {
  input: shape({
    subjectId: field.subject(),
    nickname: field.string({ maxLength: 40 }).personal({ subject: 'subjectId' }),
  }),
  errors: [wrongPassword],
  principal: 'operator',
  decide: () => {
    throw wrongPassword();
  },
});

/** A command without a secret. */
const plain = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }) }),
  principal: 'operator',
  decide: () => ({}),
});

/** A command that always refuses with a declared error: a wrong password. */
const guard = defineCommand(restBase, {
  input: shape({ password: field.secret() }),
  errors: [wrongPassword],
  principal: 'operator',
  decide: () => {
    throw wrongPassword();
  },
});

/** An asynchronous command with a secret member: its job row seals it. */
const later = defineCommand(restBase, {
  execution: 'async',
  input: shape({ label: field.string({ maxLength: 40 }), password: field.secret() }),
  principal: 'operator',
  decide: () => ({}),
});

/**
 * Enqueues `later` under a command id the caller names: the job takes over the accepted receipt of
 * that id.
 */
const queue = defineCommand(restBase, {
  input: shape({
    id: field.string(),
    label: field.string({ maxLength: 40 }),
    password: field.secret(),
  }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      enqueue(
        later,
        { label: input.label, password: input.password as never },
        { commandId: input.id },
      ),
    ],
  }),
});

/** Runs `sign` nested, with a secret of its own. */
const nest = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }) }),
  principal: 'operator',
  decide: (input) => ({
    effects: [invoke(sign, { label: input.label, password: 'nested-secret-4711' as never })],
  }),
});

/** Times `sign` with a secret of its own: the timer job seals it. */
const arm = defineCommand(restBase, {
  input: shape({ label: field.string({ maxLength: 40 }) }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      setTimer({
        key: 'rest-arm',
        after: '1h',
        invoke: sign,
        input: { label: input.label, password: 'timer-secret-4711' as never },
      }),
    ],
  }),
});

/** An effect whose input carries a secret: its record seals it. */
const ship = defineEffect(restBase, {
  performer: 'external',
  input: shape({ to: field.string(), token: field.secret() }),
});

const dispatch = defineCommand(restBase, {
  input: shape({ to: field.string() }),
  principal: 'operator',
  decide: (input) => ({
    effects: [ship({ to: input.to, token: 'effect-secret-4711' as never })],
  }),
});

const allow = <C extends object>(command: C) =>
  defineRule(restBase, command as never, { effect: 'allow', principal: 'operator' } as never);
const items = defineRule(restBase, item, {
  effect: 'allow',
  actions: ['read', 'write'],
  principal: 'operator',
  reason: 'An operator reads and writes every item.',
});

/**
 * An operator may use the generated set of a thread; the tests send items the set refuses one by
 * one.
 */
const threads = defineRule(restBase, thread, {
  effect: 'allow',
  actions: ['set'],
  principal: 'operator',
  reason: 'An operator sets threads.',
});

const restDef = defineModule(restBase, {
  actions: {
    sign,
    queue,
    record,
    register,
    note,
    refuse,
    plain,
    guard,
    later,
    nest,
    arm,
    dispatch,
  },
  effects: { ship },
  policies: {
    sign: { operators: allow(sign) },
    queue: { operators: allow(queue) },
    record: { operators: allow(record) },
    register: { operators: allow(register) },
    note: { operators: allow(note) },
    refuse: { operators: allow(refuse) },
    plain: { operators: allow(plain) },
    guard: { operators: allow(guard) },
    later: { operators: allow(later) },
    nest: { operators: allow(nest) },
    arm: { operators: allow(arm) },
    dispatch: { operators: allow(dispatch) },
    item: { operators: items },
    thread: { operators: threads },
  },
});
interface Rest extends ModuleType<typeof restDef> {}
const rest: Rest = restDef;

const appDef = defineApp({ id: 'fingerprint-at-rest', modules: [rest] as const });
interface RestApp extends AppType<typeof appDef> {}

/**
 * An app of commands that carry a secret through every path a digest or a copy of an input is
 * stored by: a sync command, a refused one, an asynchronous one, a nested invoke, a timer, an
 * effect, and the generated create and update of an entity with a secret member.
 */
export const fingerprintAtRestApp: RestApp = appDef;

/** The tenant scope of the first tenant of a runtime of the app. */
export const restScopeOf = (runtime: TestRuntime<typeof fingerprintAtRestApp>): Scope => ({
  level: 'tenant',
  backendId: runtime.backendId,
  tenantId: runtime.tenants.acme?.id ?? '',
});
