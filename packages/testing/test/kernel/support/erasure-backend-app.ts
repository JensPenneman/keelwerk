import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';

const entities = {
  person: defineEntity({
    prefix: 'bkp',
    dataSubject: 'id',
    fields: { email: field.string().personal() },
  }),
  /** A row the subject owns, whose id is the principal id of a session. */
  session: defineEntity({
    prefix: 'bks',
    dataSubject: 'ownerId',
    fields: { ownerId: field.subject(), label: field.string() },
  }),
  /** What a backend command writes. */
  note: defineEntity({ prefix: 'bkn', tenancy: 'backend', fields: { text: field.string() } }),
};
const base = defineModuleBase({ id: 'bk', version: '0.1.0', entities });

const enrol = defineCommand(base, {
  input: shape({ email: field.string() }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.person);
    return { events: [ctx.write.bk.person.create({ id, email: input.email })], result: { id } };
  },
});

const open = defineCommand(base, {
  input: shape({ ownerId: field.subject() }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.session);
    return {
      events: [ctx.write.bk.session.create({ id, ownerId: input.ownerId, label: 'session' })],
      result: { id },
    };
  },
});

/** A command of the backend scope that reads the user agent: its decision record keeps the request under the long-lived key of the principal's id. */
const stamp = defineCommand(base, {
  scope: 'backend',
  input: shape({ text: field.string() }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const agent = ctx.request.userAgent;
    const id = yield* ctx.newId(entities.note);
    return {
      events: [ctx.write.bk.note.create({ id, text: agent === undefined ? 'none' : input.text })],
      result: { id },
    };
  },
});

/** A command of the tenant that reads the user agent: the same principal id, in the tenant this time. */
const touch = defineCommand(base, {
  input: shape({ sessionId: field.ref.own('session') }),
  principal: 'operator',
  *decide(input, ctx) {
    const agent = ctx.request.userAgent;
    const row = yield* ctx.load.bk.session.one({ where: { id: input.sessionId } });
    if (row === undefined) return [];
    return [ctx.write.bk.session.update(row, { label: agent === undefined ? 'none' : 'touched' })];
  },
});

const bk = defineModule(base, {
  actions: { enrol, open, stamp, touch },
  policies: {
    enrol: { operator: defineRule(base, enrol, { effect: 'allow', principal: 'operator' }) },
    open: { operator: defineRule(base, open, { effect: 'allow', principal: 'operator' }) },
    stamp: { operator: defineRule(base, stamp, { effect: 'allow', principal: 'operator' }) },
    touch: { operator: defineRule(base, touch, { effect: 'allow', principal: 'operator' }) },
  },
});

/** Persons, the sessions they own and a backend command that a session's principal runs. */
export const backendApp = defineApp({ id: 'erasure-backend', modules: [bk] });
