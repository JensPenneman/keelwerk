import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';

/** A row the subject owns, with one secret that a command can replace. */
const member = defineEntity({
  prefix: 'lmb',
  dataSubject: 'id',
  fields: { email: field.string().personal(), token: field.secret().optional() },
});
/** A row owned by the subject its `owner` names, which a command can give to another. */
const parcel = defineEntity({
  prefix: 'lpc',
  dataSubject: 'owner',
  fields: { owner: field.subject(), secret: field.secret() },
});
const lateBase = defineModuleBase({
  id: 'late',
  version: '0.1.0',
  entities: { member, parcel },
});

/** An effect that names its data subject and holds no personal member: only its secret. */
const ship = defineEffect(lateBase, {
  performer: 'external',
  input: shape({ owner: field.subject(), waybill: field.secret() }),
  dataSubject: 'owner',
});

const enrol = defineCommand(lateBase, {
  input: shape({ email: field.string(), token: field.secret() }),
  output: shape({ id: field.ref.own('member') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(member);
    return {
      events: [ctx.write.late.member.create({ id, email: input.email, token: input.token })],
      result: { id },
    };
  },
});

const reset = defineCommand(lateBase, {
  input: shape({ id: field.ref.own('member'), token: field.secret() }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.late.member.one({ where: { id: input.id } });
    return row === undefined ? [] : [ctx.write.late.member.update(row, { token: input.token })];
  },
});

const post = defineCommand(lateBase, {
  input: shape({ owner: field.subject(), secret: field.secret() }),
  output: shape({ id: field.ref.own('parcel') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(parcel);
    return {
      events: [ctx.write.late.parcel.create({ id, owner: input.owner, secret: input.secret })],
      result: { id },
    };
  },
});

const give = defineCommand(lateBase, {
  input: shape({ id: field.ref.own('parcel'), owner: field.subject() }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.late.parcel.one({ where: { id: input.id } });
    return row === undefined ? [] : [ctx.write.late.parcel.update(row, { owner: input.owner })];
  },
});

const send = defineCommand(lateBase, {
  input: shape({ owner: field.subject(), waybill: field.secret() }),
  principal: 'user',
  decide: (input) => ({ effects: [ship({ owner: input.owner, waybill: input.waybill })] }),
});

const late = defineModule(lateBase, {
  actions: { enrol, reset, post, give, send },
  effects: { ship },
  policies: {
    enrol: { operator: defineRule(lateBase, enrol, { effect: 'allow', principal: 'operator' }) },
    reset: { operator: defineRule(lateBase, reset, { effect: 'allow', principal: 'operator' }) },
    post: { operator: defineRule(lateBase, post, { effect: 'allow', principal: 'operator' }) },
    give: { operator: defineRule(lateBase, give, { effect: 'allow', principal: 'operator' }) },
    send: { user: defineRule(lateBase, send, { effect: 'allow', principal: 'user' }) },
  },
});

/** An owned row whose secret is replaced, and an effect that names its subject and no personal member. */
export const lateApp = defineApp({ id: 'erasure-late', modules: [late] });
