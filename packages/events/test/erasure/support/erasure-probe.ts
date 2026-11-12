import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';

const personDef = defineEntity({
  prefix: 'ppr',
  dataSubject: 'id',
  fields: {
    name: field.string({ maxLength: 100 }),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ normalize: 'email', queries: ['prefix'] }),
    notes: field.string().optional().personal(),
    /** A friend's note on this person: the personal value of ANOTHER subject on this row. */
    friendId: field.subject().optional(),
    friendNote: field.string().optional().personal({ subject: 'friendId' }),
  },
});
interface Person extends EntityType<typeof personDef> {}
const person: Person = personDef;

/** Owned by `ownerId`; its `reply` is the personal value of another subject, `replierId`. */
const threadDef = defineEntity({
  prefix: 'pth',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    topic: field.string().optional().personal(),
    ownerId: field.subject(),
    replierId: field.subject().optional(),
    reply: field.string().optional().personal({ subject: 'replierId' }),
  },
});
interface Thread extends EntityType<typeof threadDef> {}
const thread: Thread = threadDef;

const probeBaseDef = defineModuleBase({
  id: 'probe',
  version: '0.1.0',
  entities: { person, thread },
  flags: {
    beta: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});
interface ProbeBase extends ModuleBaseType<typeof probeBaseDef> {}
const probeBase: ProbeBase = probeBaseDef;

const enrol = defineCommand(probeBase, {
  input: shape({
    name: field.string({ maxLength: 100 }),
    email: field.string({ format: 'email' }),
    notes: field.string().optional(),
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

const befriend = defineCommand(probeBase, {
  input: shape({
    personId: field.ref.own('person'),
    friendId: field.subject(),
    note: field.string(),
  }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.probe.person.one({ where: { id: input.personId } });
    if (row === undefined) return [];
    return [
      ctx.write.probe.person.update(row, { friendId: input.friendId, friendNote: input.note }),
    ];
  },
});

const enrolRule = defineRule(probeBase, enrol, { effect: 'allow', principal: 'operator' });
const openRule = defineRule(probeBase, open, { effect: 'allow', principal: 'operator' });
const answerRule = defineRule(probeBase, answer, { effect: 'allow', principal: 'operator' });
const befriendRule = defineRule(probeBase, befriend, { effect: 'allow', principal: 'operator' });

const probeDef = defineModule(probeBase, {
  actions: { enrol, open, answer, befriend },
  policies: {
    enrol: { operators: enrolRule },
    open: { operators: openRule },
    answer: { operators: answerRule },
    befriend: { operators: befriendRule },
  },
});
interface Probe extends ModuleType<typeof probeDef> {}
const probe: Probe = probeDef;

const probeAppDef = defineApp({ id: 'erasure-probe', modules: [probe] as const });
interface ProbeApp extends AppType<typeof probeAppDef> {}

/** A small app of personal data: people with personal fields, and threads that hold another subject's reply. */
export const erasureProbeApp: ProbeApp = probeAppDef;
