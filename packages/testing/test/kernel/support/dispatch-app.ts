import {
  cancelTimer,
  contracts,
  core,
  defineApp,
  defineCommand,
  defineEffect,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  type Id,
  mapItems,
  outcomeOf,
  setTimer,
  settle,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const delivery = defineEntity({
  prefix: 'dlv',
  fields: {
    parcel: field.string(),
    ok: field.boolean(),
    code: field.string().optional(),
    tracking: field.string().optional(),
  },
});
const dispatchBase = defineModuleBase({
  id: 'dispatch',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { delivery },
});

/** An effect an outside courier performs: the recipient is personal, so it never reaches the courier's stream. */
const ship = defineEffect(dispatchBase, {
  performer: 'external',
  input: shape({
    owner: field.subject(),
    parcel: field.string(),
    depot: field.string(),
    recipient: field.string().personal(),
  }),
  output: shape({ tracking: field.string() }),
  dataSubject: 'owner',
});

/** An effect whose input has one member of each kind the stored event form changes: an instant, a wide integer, bytes and a set. */
const stampInput = {
  at: field.instant(),
  n: field.integer({ wide: true }),
  raw: field.binary(),
  tags: field.set(field.string()),
};
const stamp = defineEffect(dispatchBase, {
  performer: 'external',
  input: shape(stampInput),
  output: shape({}),
});

const stampIt = defineCommand(dispatchBase, {
  input: shape(stampInput),
  principal: 'user',
  decide: (input) => ({ effects: [stamp(input)] }),
});

/** The condition each `by` follows: one where per kind of member. */
const stampWheres = {
  at: { at: { gt: Temporal.Instant.from('2026-01-01T00:00:00Z') } },
  n: { n: { gte: 5n } },
  raw: { raw: { eq: new Uint8Array([1, 2]) } },
  tags: { tags: { contains: 'a' } },
} as const;

const stamped = defineSubscription(dispatchBase, {
  input: shape({ by: field.enum(['at', 'n', 'raw', 'tags']) }),
  event: shape({ id: field.ref(core, 'effect'), ...stampInput }),
  principal: 'user',
  source: (input, ctx, resume) =>
    mapItems(
      ctx.live.effects(stamp, { where: stampWheres[input.by], after: resume }),
      (effect) => ({
        id: effect.id,
        ...effect.input,
        // A set member is optional in the plain input's type (field.set drops the personal flag).
        tags: effect.input.tags ?? new Set<string>(),
      }),
    ),
});

const shipped = defineCommand(dispatchBase, {
  input: outcomeOf(ship, shape({ parcel: field.string() })),
  principal: 'service',
  decide: (input, ctx) => ({
    events: [
      ctx.write.dispatch.delivery.create({
        parcel: input.parcel,
        ok: input.outcome.ok,
        ...(input.outcome.ok ? { tracking: input.outcome.value.tracking } : {}),
      }),
    ],
  }),
});

const send = defineCommand(dispatchBase, {
  input: shape({
    owner: field.subject(),
    parcel: field.string(),
    depot: field.string(),
    recipient: field.string(),
    deadline: field.instant().optional(),
    runAt: field.instant().optional(),
  }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      ship(
        {
          owner: input.owner,
          parcel: input.parcel,
          depot: input.depot,
          recipient: input.recipient,
        },
        {
          continueWith: shipped,
          with: { parcel: input.parcel },
          ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
          ...(input.runAt === undefined ? {} : { runAt: input.runAt }),
        },
      ),
    ],
  }),
});

const report = defineCommand(dispatchBase, {
  input: shape({
    effectId: field.ref(core, 'effect'),
    ok: field.boolean(),
    tracking: field.string().optional(),
    code: field.string().optional(),
    message: field.string().optional(),
  }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      settle(
        input.effectId,
        input.ok
          ? { ok: true, value: { tracking: input.tracking ?? '' } }
          : { ok: false, error: { code: input.code ?? 'x', message: input.message ?? '' } },
      ),
    ],
  }),
});

/** A settle whose id is plain text: a module that took the id as a string can pass any spelling of it on. */
const reportLoose = defineCommand(dispatchBase, {
  input: shape({ effectId: field.string(), tracking: field.string() }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      settle(input.effectId as Id<'core.effect'>, {
        ok: true,
        value: { tracking: input.tracking },
      }),
    ],
  }),
});

const pending = defineSubscription(dispatchBase, {
  input: shape({ depot: field.string() }),
  event: shape({
    id: field.ref(core, 'effect'),
    parcel: field.string(),
    depot: field.string(),
    deadline: field.instant().optional(),
  }),
  principal: 'user',
  source: (input, ctx, resume) =>
    mapItems(
      ctx.live.effects(ship, { where: { depot: input.depot }, after: resume }),
      (effect) => ({
        id: effect.id,
        parcel: effect.input.parcel,
        depot: effect.input.depot,
        ...(effect.deadline === undefined ? {} : { deadline: effect.deadline }),
      }),
    ),
});

const dispatch = defineModule(dispatchBase, {
  actions: { send, report, reportLoose, shipped, pending, stampIt, stamped },
  effects: { ship, stamp },
  policies: {
    send: { signedIn: defineRule(dispatchBase, send, { effect: 'allow', principal: 'user' }) },
    report: { signedIn: defineRule(dispatchBase, report, { effect: 'allow', principal: 'user' }) },
    pending: {
      signedIn: defineRule(dispatchBase, pending, { effect: 'allow', principal: 'user' }),
    },
    reportLoose: {
      signedIn: defineRule(dispatchBase, reportLoose, { effect: 'allow', principal: 'user' }),
    },
    stampIt: {
      signedIn: defineRule(dispatchBase, stampIt, { effect: 'allow', principal: 'user' }),
    },
    stamped: {
      signedIn: defineRule(dispatchBase, stamped, { effect: 'allow', principal: 'user' }),
    },
  },
});

const rogueBase = defineModuleBase({ id: 'rogue', version: '0.1.0' });
const noop = defineCommand(rogueBase, { principal: 'user', decide: () => ({}) });
const cancelIt = defineCommand(rogueBase, {
  input: shape({ key: field.string() }),
  principal: 'user',
  decide: (input) => ({ effects: [cancelTimer(input.key)] }),
});
const replaceIt = defineCommand(rogueBase, {
  input: shape({ key: field.string() }),
  principal: 'user',
  decide: (input) => ({
    effects: [setTimer({ key: input.key, after: '1s', invoke: noop, input: {} })],
  }),
});
const settleIt = defineCommand(rogueBase, {
  input: shape({ effectId: field.ref(core, 'effect') }),
  principal: 'user',
  decide: (input) => ({ effects: [settle(input.effectId, { ok: true, value: {} })] }),
});
const rogue = defineModule(rogueBase, {
  actions: { noop, cancelIt, replaceIt, settleIt },
  policies: {
    noop: { signedIn: defineRule(rogueBase, noop, { effect: 'allow', principal: 'user' }) },
    cancelIt: {
      signedIn: defineRule(rogueBase, cancelIt, { effect: 'allow', principal: 'user' }),
    },
    replaceIt: {
      signedIn: defineRule(rogueBase, replaceIt, { effect: 'allow', principal: 'user' }),
    },
    settleIt: {
      signedIn: defineRule(rogueBase, settleIt, { effect: 'allow', principal: 'user' }),
    },
  },
});

/** The test-local app: a courier performs `dispatch.ship` outside the process; `rogue` is a module that tries what no module may. */
export const dispatchApp = defineApp({ id: 'dispatch-app', modules: [live, dispatch, rogue] });
export const dispatchUrl = 'https://dispatch.example.test';
