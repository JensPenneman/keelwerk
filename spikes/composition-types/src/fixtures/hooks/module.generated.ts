// Generated from the module's directories (decision 59b); do not edit.
import { defineModule, type ModuleType } from '../../define-module.ts';
import { notify as actionsNotify } from './actions/notify.ts';
import { testEndpoint as actionsTestEndpoint } from './actions/test-endpoint.ts';
import { hooksBase } from './base.ts';
import { post as effectsPost } from './effects/post.ts';
import { recordOutcome as entityActionsDeliveryRecordOutcome } from './entity-actions/delivery/record-outcome.ts';
import { post as executorsPost } from './executors/post.ts';

const moduleDef = defineModule(hooksBase, {
  actions: {
    notify: actionsNotify,
    testEndpoint: actionsTestEndpoint,
  },
  effects: {
    post: effectsPost,
  },
  executors: {
    post: executorsPost,
  },
  entityActions: {
    delivery: {
      recordOutcome: entityActionsDeliveryRecordOutcome,
    },
  },
});

/** The hooks module. */
export interface Hooks extends ModuleType<typeof moduleDef> {}

/** The hooks module value. */
export const hooks: Hooks = moduleDef;
