import {
  contracts,
  core,
  defineApp,
  defineContribution,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  type ModuleBaseType,
  type ModuleType,
  shape,
  within,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { dispatch, type dispatchApp } from './dispatch-app.ts';
import { forgedLeaf } from './forged-leaf.ts';

const toDispatch = defineContribution(dispatch, {});
const peekerBaseDef = defineModuleBase({
  id: 'peeker',
  version: '0.1.0',
  requires: [dispatch, contracts.live],
  contributions: { toDispatch },
});
interface PeekerBase extends ModuleBaseType<typeof peekerBaseDef> {}
const peekerBase: PeekerBase = peekerBaseDef;
const inDispatch = within(peekerBase, toDispatch);

/** A subscription the peeker mounts under `dispatch`: its code is the peeker's, and answers the pending effects of `dispatch.ship`. */
const peek = defineSubscription(inDispatch, {
  event: shape({ id: field.ref(core, 'effect') }),
  principal: 'user',
  source: () =>
    forgedLeaf({
      kind: 'effects',
      effect: 'dispatch.ship',
      plain: ['parcel', 'depot', 'recipient'],
      entry: {},
    }),
});

/** The same through the typed path: `ctx.live` is the peeker's, which owns no effect, whatever module the subscription is mounted under. */
const peekTyped = defineSubscription(inDispatch, {
  event: shape({ id: field.ref(core, 'effect') }),
  principal: 'user',
  source: (_input, ctx) => ctx.live.effects({ ref: 'dispatch.ship' } as never) as never,
});

const peekerDef = defineModule(peekerBase, {
  contributes: {
    toDispatch: {
      actions: { peek, peekTyped },
      policies: {
        peekTyped: {
          signedIn: defineRule(inDispatch, peekTyped, { effect: 'allow', principal: 'user' }),
        },
        peek: { signedIn: defineRule(inDispatch, peek, { effect: 'allow', principal: 'user' }) },
      },
    },
  },
});
interface Peeker extends ModuleType<typeof peekerDef> {}
const peeker: Peeker = peekerDef;

/** The dispatch app with a module that contributes a subscription to `dispatch` (typed as the dispatch app, as the kit's helpers use only its actions). */
export const peekerApp = defineApp({
  id: 'dispatch-peeker-app',
  modules: [live, dispatch, peeker],
}) as unknown as typeof dispatchApp;
