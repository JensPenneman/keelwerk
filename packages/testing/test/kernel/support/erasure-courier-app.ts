import {
  contracts,
  core,
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  mapItems,
  outcomeOf,
  settle,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const logbook = defineEntity({
  prefix: 'lgb',
  fields: { parcel: field.string(), ok: field.boolean(), code: field.string().optional() },
});
const courierBase = defineModuleBase({
  id: 'courier',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { logbook },
});

/** An effect an outside courier performs: the recipient is personal, the waybill and the seal are secret. */
const ship = defineEffect(courierBase, {
  performer: 'external',
  input: shape({
    owner: field.subject(),
    parcel: field.string(),
    recipient: field.string().personal(),
    waybill: field.secret(),
  }),
  output: shape({ tracking: field.string(), seal: field.secret() }),
  dataSubject: 'owner',
});

/** The same effect performed by the process itself: an executor, which a test can hold in the middle of an attempt. */
const dispatch = defineEffect(courierBase, {
  input: shape({
    owner: field.subject(),
    recipient: field.string().personal(),
    waybill: field.secret(),
  }),
  output: shape({ seal: field.secret() }),
  dataSubject: 'owner',
});

/** What a test hangs on the attempt of the executor: it runs once, in the middle of the attempt. */
const attempt: { during?: () => Promise<void> } = {};

const dispatchExecutor = defineEffectExecutor(courierBase, dispatch, {
  // One attempt at a time: an effect requested during an attempt stays unbegun until it ends.
  group: () => ({ id: 'courier.dispatch', concurrency: 1 }),
  run: async () => {
    const { during } = attempt;
    delete attempt.during;
    await during?.();
    return { seal: 'executor seal marker' as never };
  },
});

const dispatchNow = defineCommand(courierBase, {
  input: shape({
    owner: field.subject(),
    recipient: field.string(),
    waybill: field.secret(),
  }),
  principal: 'user',
  decide: (input) => ({ effects: [dispatch(input)] }),
});

const shipped = defineCommand(courierBase, {
  input: outcomeOf(ship, shape({ parcel: field.string() })),
  principal: 'service',
  decide: (input, ctx) => ({
    events: [
      ctx.write.courier.logbook.create({
        parcel: input.parcel,
        ok: input.outcome.ok,
        ...(input.outcome.ok ? {} : { code: input.outcome.error.code }),
      }),
    ],
  }),
});

const send = defineCommand(courierBase, {
  input: shape({
    owner: field.subject(),
    parcel: field.string(),
    recipient: field.string(),
    waybill: field.secret(),
    deadline: field.instant().optional(),
  }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      ship(
        {
          owner: input.owner,
          parcel: input.parcel,
          recipient: input.recipient,
          waybill: input.waybill,
        },
        {
          continueWith: shipped,
          with: { parcel: input.parcel },
          ...(input.deadline === undefined ? {} : { deadline: input.deadline }),
        },
      ),
    ],
  }),
});

const report = defineCommand(courierBase, {
  input: shape({ effectId: field.ref(core, 'effect'), seal: field.string() }),
  principal: 'user',
  decide: (input) => ({
    effects: [settle(input.effectId, { ok: true, value: { tracking: 'T-1', seal: input.seal } })],
  }),
});

const pending = defineSubscription(courierBase, {
  input: shape({}),
  event: shape({ id: field.ref(core, 'effect'), parcel: field.string() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.effects(ship, { after: resume }), (effect) => ({
      id: effect.id,
      parcel: effect.input.parcel,
    })),
});

const courier = defineModule(courierBase, {
  actions: { send, dispatchNow, report, shipped, pending },
  effects: { ship, dispatch },
  executors: { dispatch: dispatchExecutor },
  policies: {
    send: { signedIn: defineRule(courierBase, send, { effect: 'allow', principal: 'user' }) },
    dispatchNow: {
      signedIn: defineRule(courierBase, dispatchNow, { effect: 'allow', principal: 'user' }),
    },
    report: { signedIn: defineRule(courierBase, report, { effect: 'allow', principal: 'user' }) },
    pending: { signedIn: defineRule(courierBase, pending, { effect: 'allow', principal: 'user' }) },
  },
});

/** A courier performs `courier.ship` outside the process; the shipment keeps a secret waybill and gets a secret seal. */
const courierApp = defineApp({ id: 'erasure-courier', modules: [live, courier] });

export { attempt, courierApp };
