import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  mapItems,
  shape,
} from '@keelwerk/core';

const notice = defineEntity({
  prefix: 'ntc',
  fields: { text: field.string() },
  tenancy: 'backend',
});

interface NoticesBase extends ModuleBaseType<typeof noticesBaseDef> {}

const noticesBaseDef = defineModuleBase({
  id: 'notices',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { notice },
});
const noticesBase: NoticesBase = noticesBaseDef;

/** The notices of the backend, followed at the backend level. */
const feed = defineSubscription(noticesBase, {
  event: shape({ type: field.string(), id: field.string() }),
  input: shape({}),
  principal: 'user',
  scope: 'backend',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('notices', 'notice', { from: 'now', after: resume }), (change) => ({
      type: change.type,
      id: change.id,
    })),
});

const noticesDef = defineModule(noticesBase, {
  actions: { feed },
  policies: {
    notice: {
      readers: defineRule(noticesBase, notice, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
      }),
    },
    feed: { users: defineRule(noticesBase, feed, { effect: 'allow', principal: 'user' }) },
  },
});

/** A module with one backend-level entity and a subscription at the backend level, for the tests of backend tickets. */
export interface Notices extends ModuleType<typeof noticesDef> {}

/** The test module. */
export const notices: Notices = noticesDef;
