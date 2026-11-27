import {
  core,
  defineApp,
  defineCommand,
  defineContribution,
  defineEntity,
  defineFill,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  type Id,
  shape,
  within,
} from '@keelwerk/core';

/**
 * A personal value of the data subject on a row owned through a path, so the reference walk finds it.
 * The row that holds the owner field has none: an owner that a personal value of the row needs
 * cannot be cleared (the write refuses it).
 */
const itemNote = field.string().personal().optional();
const noted = new Set(['item2', 'item3']);
/** The rows whose data subject is a plain field, a path of two segments and a path of three. */
const entities = {
  member: defineEntity({
    prefix: 'chm',
    dataSubject: 'id',
    fields: { email: field.string().personal() },
  }),
  parcel: defineEntity({
    prefix: 'chp',
    dataSubject: 'owner',
    fields: { owner: field.subject().optional(), secret: field.secret() },
  }),
  holder2: defineEntity({ prefix: 'chh', fields: { owner: field.subject().optional() } }),
  item2: defineEntity({
    prefix: 'chi',
    dataSubject: 'holderId.owner',
    fields: { holderId: field.ref.own('holder2'), note: itemNote, secret: field.secret() },
  }),
  holder3: defineEntity({ prefix: 'chj', fields: { owner: field.subject().optional() } }),
  box3: defineEntity({ prefix: 'chb', fields: { holderId: field.ref.own('holder3') } }),
  parcelHidden: defineEntity({
    prefix: 'chq',
    dataSubject: 'owner',
    fields: { owner: field.subject().hidden(), secret: field.secret() },
  }),
  parcelState: defineEntity({
    prefix: 'chs',
    dataSubject: 'owner',
    fields: { owner: field.subject().stateOnly(), secret: field.secret() },
  }),
  holderHidden: defineEntity({ prefix: 'chd', fields: { owner: field.subject().hidden() } }),
  itemHidden: defineEntity({
    prefix: 'chn',
    dataSubject: 'holderId.owner',
    fields: { holderId: field.ref.own('holderHidden'), secret: field.secret() },
  }),
  /** An owner field that can stay empty, and a personal value of each of two other subjects. */
  memo: defineEntity({
    prefix: 'chy',
    dataSubject: 'owner',
    fields: {
      owner: field.subject().optional(),
      aboutId: field.subject(),
      otherId: field.subject(),
      about: field.string().personal({ subject: 'aboutId' }),
      other: field.string().personal({ subject: 'otherId' }),
      secret: field.secret(),
    },
  }),
  /** A holder that nobody owns at first, and a row owned through it that holds a personal value of another subject. */
  holder4: defineEntity({ prefix: 'chw', fields: { owner: field.subject().optional() } }),
  deed: defineEntity({
    prefix: 'chv',
    dataSubject: 'holderId.owner',
    fields: {
      holderId: field.ref.own('holder4'),
      aboutId: field.subject(),
      about: field.string().personal({ subject: 'aboutId' }),
      secret: field.secret(),
    },
  }),
  mark: defineEntity({ prefix: 'chz', fields: { label: field.string() } }),
  /** A row that names an address and is its own data subject, like a pending invitation: the step `reach` finds it. */
  pledge: defineEntity({
    prefix: 'chl',
    dataSubject: 'subject',
    fields: {
      subject: field.subject().index(),
      email: field.string({ format: 'email' }).personal({ normalize: 'email', queries: ['eq'] }),
    },
  }),
  item3: defineEntity({
    prefix: 'chk',
    dataSubject: 'boxId.holderId.owner',
    fields: { boxId: field.ref.own('box3'), note: itemNote, secret: field.secret() },
  }),
};
const toCore = defineContribution(core, {});
const base = defineModuleBase({
  id: 'chain',
  version: '0.1.0',
  entities,
  contributions: { toCore },
});
/** The field of each entity that `make` fills from `link`. */
const linkOf = {
  member: 'email',
  parcel: 'owner',
  holder2: 'owner',
  item2: 'holderId',
  holder3: 'owner',
  box3: 'holderId',
  item3: 'boxId',
  parcelHidden: 'owner',
  parcelState: 'owner',
  holderHidden: 'owner',
  itemHidden: 'holderId',
  holder4: 'owner',
} as const;
type Kind = keyof typeof linkOf;

const make = defineCommand(base, {
  input: shape({
    kind: field.string(),
    link: field.string(),
    secret: field.secret().optional(),
  }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const kind = input.kind as Kind;
    const id = yield* ctx.newId(entities[kind]);
    const values = {
      id,
      [linkOf[kind]]: input.link,
      secret: input.secret,
      ...(noted.has(kind) ? { note: `note of ${input.link}` } : {}),
    };
    const write = (ctx.write.chain as never as Record<string, { create(v: unknown): never }>)[kind];
    return { events: [write?.create(values) as never], result: { id } };
  },
});

/** Changes one field of a row: the link, or the secret; `clear` empties the owner of a row that may have none. */
const change = defineCommand(base, {
  input: shape({
    kind: field.string(),
    id: field.string(),
    link: field.string().optional(),
    secret: field.secret().optional(),
    clear: field.boolean().optional(),
  }),
  principal: 'operator',
  *decide(input, ctx) {
    const kind = input.kind as Kind;
    const load = (
      ctx.load.chain as never as Record<string, { one(q: unknown): Generator<never, unknown> }>
    )[kind];
    const row = yield* load?.one({ where: { id: input.id } }) as Generator<never, unknown>;
    const write = (
      ctx.write.chain as never as Record<string, { update(r: unknown, v: unknown): never }>
    )[kind];
    const patch =
      input.clear === true
        ? { owner: null }
        : input.secret === undefined
          ? { [linkOf[kind]]: input.link }
          : { secret: input.secret };
    return row === undefined ? [] : [write?.update(row, patch) as never];
  },
});

/** A row of two subjects' personal values; `owner` is left out for a row that nobody owns. */
const makeMemo = defineCommand(base, {
  input: shape({
    aboutId: field.string(),
    otherId: field.string(),
    owner: field.string().optional(),
    secret: field.secret(),
  }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.memo);
    const values = {
      id,
      aboutId: input.aboutId,
      otherId: input.otherId,
      about: `about ${input.aboutId}`,
      other: `about ${input.otherId}`,
      secret: input.secret,
      ...(input.owner === undefined ? {} : { owner: input.owner }),
    };
    return { events: [ctx.write.chain.memo.create(values as never)], result: { id } };
  },
});
/** A holder that nobody owns and a deed owned through it, holding a value of `aboutId`. */
const makeDeed = defineCommand(base, {
  input: shape({ aboutId: field.string(), secret: field.secret() }),
  output: shape({ id: field.string(), holderId: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const holderId = yield* ctx.newId(entities.holder4);
    const id = yield* ctx.newId(entities.deed);
    const values = { id, holderId, aboutId: input.aboutId, about: 'about', secret: input.secret };
    return {
      events: [
        ctx.write.chain.holder4.create({ id: holderId }),
        ctx.write.chain.deed.create(values as never),
      ],
      result: { id, holderId },
    };
  },
});
/** A command of a subject (through a principal id of a row of hers): it leaves a receipt that names the id. */
const ping = defineCommand(base, {
  input: shape({ label: field.string() }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.mark);
    return [ctx.write.chain.mark.create({ id, label: input.label })];
  },
});

/** A pledge to an address: its own subject is its id. */
const makePledge = defineCommand(base, {
  input: shape({ email: field.string() }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.pledge);
    return {
      events: [ctx.write.chain.pledge.create({ id, subject: id, email: input.email } as never)],
      result: { id },
    };
  },
});

/** The step `reach` of an erasure: a member's address is its email, and the pledges to an address are the rows that name it. */
const reachFill = defineFill(within(base, toCore), 'erasureReach', (own) => [
  {
    id: 'chain.reach',
    *addressesOf(subject) {
      const member = yield* own.load.chain.member.one({
        where: { id: subject as Id<'chain.member'> },
      });
      return member === undefined ? [] : [member.email];
    },
    *heldBy(addresses) {
      const found: { type: string; id: string }[] = [];
      for (const email of addresses) {
        const rows = yield* own.load.chain.pledge.many({ where: { email } });
        found.push(...rows.map((row) => ({ type: 'chain.pledge', id: row.id })));
      }
      return found;
    },
  },
]);

const chain = defineModule(base, {
  actions: { make, change, makeMemo, makeDeed, ping, makePledge },
  contributes: { toCore: { extensionPoints: { erasureReach: reachFill } } },
  policies: {
    makePledge: {
      operator: defineRule(base, makePledge, { effect: 'allow', principal: 'operator' }),
    },
    make: { operator: defineRule(base, make, { effect: 'allow', principal: 'operator' }) },
    change: { operator: defineRule(base, change, { effect: 'allow', principal: 'operator' }) },
    makeMemo: { operator: defineRule(base, makeMemo, { effect: 'allow', principal: 'operator' }) },
    makeDeed: { operator: defineRule(base, makeDeed, { effect: 'allow', principal: 'operator' }) },
    ping: { user: defineRule(base, ping, { effect: 'allow', principal: 'user' }) },
  },
});

/** Owned rows at three depths, with commands that make a row and change its link or its secret. */
export const chainApp = defineApp({ id: 'erasure-chain', modules: [chain] });
