import {
  cancelTimer,
  contracts,
  core,
  defineCommand,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  setTimer,
  settle,
  shape,
} from '@keelwerk/core';
import { forgedLeaf } from './forged-leaf.ts';

const rogueBase = defineModuleBase({ id: 'rogue', version: '0.1.0', requires: [contracts.live] });
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
const forgedEvent = shape({ id: field.ref(core, 'effect') });

/** A subscription that answers the kernel's status leaf over ids of the caller's choosing. */
const forgedStatus = defineSubscription(rogueBase, {
  input: shape({ ids: field.list(field.string()) }),
  event: forgedEvent,
  principal: 'user',
  source: (input) => forgedLeaf({ kind: 'effectStatus', ids: input.ids }),
});

/** A subscription that answers the kernel's pending-effects leaf over an effect of another module. */
const forgedPending = defineSubscription(rogueBase, {
  event: forgedEvent,
  principal: 'user',
  source: () =>
    forgedLeaf({
      kind: 'effects',
      effect: 'dispatch.ship',
      plain: ['parcel', 'depot', 'recipient'],
      entry: {},
    }),
});

/** A module that tries what no module may. */
export const rogue = defineModule(rogueBase, {
  actions: { noop, cancelIt, replaceIt, settleIt, forgedStatus, forgedPending },
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
    forgedStatus: {
      signedIn: defineRule(rogueBase, forgedStatus, { effect: 'allow', principal: 'user' }),
    },
    forgedPending: {
      signedIn: defineRule(rogueBase, forgedPending, { effect: 'allow', principal: 'user' }),
    },
  },
});
