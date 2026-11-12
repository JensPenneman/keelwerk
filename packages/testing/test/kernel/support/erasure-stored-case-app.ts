import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
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

const entryDef = defineEntity({
  prefix: 'cse',
  dataSubject: 'ownerId',
  fields: { title: field.string({ maxLength: 100 }), ownerId: field.subject().index() },
  generated: { watch: true },
});
interface Entry extends EntityType<typeof entryDef> {}
const entry: Entry = entryDef;

/** A row whose data subject is read through a reference (`entryId.ownerId`). */
const noteDef = defineEntity({
  prefix: 'csn',
  dataSubject: 'entryId.ownerId',
  fields: { entryId: field.ref.own('entry').index(), body: field.string().personal() },
});
interface Note extends EntityType<typeof noteDef> {}
const note: Note = noteDef;

const casingBaseDef = defineModuleBase({
  id: 'casing',
  version: '0.1.0',
  generates: ['watch'],
  requires: [contracts.live],
  entities: { entry, note },
});
interface CasingBase extends ModuleBaseType<typeof casingBaseDef> {}
const casingBase: CasingBase = casingBaseDef;

const enter = defineCommand(casingBase, {
  input: shape({ ownerId: field.subject(), title: field.string() }),
  output: shape({ entryId: field.ref.own('entry') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entry);
    return {
      events: [ctx.write.casing.entry.create({ id, ownerId: input.ownerId, title: input.title })],
      result: { entryId: id },
    };
  },
});

/** Writes the owner in upper case itself: a draft, not an input. */
const shout = defineCommand(casingBase, {
  input: shape({ ownerId: field.subject(), title: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entry);
    return [
      ctx.write.casing.entry.create({
        id,
        ownerId: input.ownerId.toUpperCase() as typeof input.ownerId,
        title: input.title,
      }),
    ];
  },
});

const addNote = defineCommand(casingBase, {
  input: shape({ entryId: field.ref.own('entry'), body: field.string() }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.casing.note.create({ id, entryId: input.entryId, body: input.body })],
      result: { noteId: id },
    };
  },
});

/** Takes a subject that is no data subject of any row: only the input validation can refuse it. */
const mention = defineCommand(casingBase, {
  input: shape({ authorId: field.subject() }),
  principal: 'operator',
  decide: () => ({}),
});

/** Enqueues `mention` with the subject in upper case: an effect input is a draft, validated as a write. */
const relay = defineCommand(casingBase, {
  input: shape({ authorId: field.subject() }),
  principal: 'operator',
  decide: (input) => ({
    effects: [
      enqueue(mention, { authorId: input.authorId.toUpperCase() as typeof input.authorId }),
    ],
  }),
});

/** Loads one row and answers its subject: the output is validated against its shape. */
const ownerOf = defineCommand(casingBase, {
  input: shape({ entryId: field.ref.own('entry') }),
  output: shape({ ownerId: field.subject() }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.casing.entry.one({ where: { id: input.entryId } });
    if (row === undefined) throw new Error('no such entry');
    return { result: { ownerId: row.ownerId } };
  },
});

/** Lists the rows and answers their subjects. */
const owners = defineCommand(casingBase, {
  input: shape({}),
  output: shape({ owners: field.list(field.subject()) }),
  principal: 'operator',
  *decide(_input, ctx) {
    const page = yield* ctx.load.casing.entry.query({});
    return { result: { owners: page.items.map((row) => row.ownerId) } };
  },
});

/** A custom stream whose items hold the subject: each item is validated against the event shape. */
const ownerEvents = defineSubscription(casingBase, {
  event: shape({ entryId: field.string(), ownerId: field.subject().optional() }),
  input: shape({}),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('casing', 'entry', { from: 'beginning', after: resume }), (change) =>
      change.type === 'removed' || change.row === undefined
        ? { entryId: change.id }
        : { entryId: change.id, ownerId: change.row.ownerId },
    ),
});

const casingDef = defineModule(casingBase, {
  actions: { enter, shout, mention, relay, addNote, ownerOf, owners, ownerEvents },
  policies: {
    enter: { operators: defineRule(casingBase, enter, { effect: 'allow', principal: 'operator' }) },
    shout: { operators: defineRule(casingBase, shout, { effect: 'allow', principal: 'operator' }) },
    mention: {
      operators: defineRule(casingBase, mention, { effect: 'allow', principal: 'operator' }),
    },
    relay: { operators: defineRule(casingBase, relay, { effect: 'allow', principal: 'operator' }) },
    addNote: {
      operators: defineRule(casingBase, addNote, { effect: 'allow', principal: 'operator' }),
    },
    ownerOf: {
      operators: defineRule(casingBase, ownerOf, { effect: 'allow', principal: 'operator' }),
    },
    owners: {
      operators: defineRule(casingBase, owners, { effect: 'allow', principal: 'operator' }),
    },
    ownerEvents: {
      users: defineRule(casingBase, ownerEvents, { effect: 'allow', principal: 'user' }),
    },
    entry: {
      readers: defineRule(casingBase, entry, {
        effect: 'allow',
        actions: ['read'],
        principal: ['user', 'operator'],
        reason: 'Everyone reads the entries.',
      }),
      writers: defineRule(casingBase, entry, {
        effect: 'allow',
        actions: ['create'],
        principal: 'operator',
        reason: 'Operators create entries in bulk.',
      }),
    },
    note: {
      readers: defineRule(casingBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: ['user', 'operator'],
        reason: 'Everyone reads the notes.',
      }),
    },
  },
});
interface Casing extends ModuleType<typeof casingDef> {}
const casing: Casing = casingDef;

const appDef = defineApp({ id: 'erasure-stored-case', modules: [live, casing] as const });
interface CasingApp extends AppType<typeof appDef> {}
/** A module whose rows hold a subject in one field and through a reference, with reads that answer the subject. */
const casingApp: CasingApp = appDef;

export { casingApp };
