import {
  contracts,
  defineApiVersions,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineQuery,
  defineRule,
  defineSubscription,
  defineVersionChange,
  field,
  type ModuleBaseType,
  type ModuleType,
  mapItems,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { library, loans } from '@keelwerk/testing/fixtures';

interface ChoresBase extends ModuleBaseType<typeof choresBaseDef> {}
const chore = defineEntity({
  prefix: 'chr',
  fields: { title: field.string() },
  generated: { watch: true },
});
const choresBaseDef = defineModuleBase({
  id: 'chores',
  version: '1.0.0',
  requires: [contracts.live],
  generates: ['watch'],
  entities: { chore },
});
const choresBase: ChoresBase = choresBaseDef;

/** A query that is deprecated from the day the stream tests start. */
const oldPing = defineQuery(choresBase, {
  principal: 'user',
  output: shape({ pong: field.boolean() }),
  deprecated: { reason: 'Use ping.', at: '2026-11-05', sunset: '2026-12-01' },
  read: () => ({ pong: true }),
});

/** A subscription that is deprecated from the same day: its notice follows the welcome of an SSE stream and precedes the first frame of a socket subscription. */
const oldWatch = defineSubscription(choresBase, {
  principal: 'user',
  event: shape({ id: field.string() }),
  deprecated: { reason: 'Use a newer stream.', at: '2026-11-05', sunset: '2026-12-01' },
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('chores', 'chore', { after: resume }), (change) =>
      change.type === 'removed' ? undefined : { id: change.id },
    ),
});

/** A subscription deprecated without a date: in force from its declaration, so its notice carries no `at`. */
const quietWatch = defineSubscription(choresBase, {
  principal: 'user',
  event: shape({ id: field.string() }),
  deprecated: { reason: 'Use a newer stream.' },
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('chores', 'chore', { after: resume }), (change) =>
      change.type === 'removed' ? undefined : { id: change.id },
    ),
});

/** The older API version knew `chores.oldWatch` as `chores.oldStream`. */
const watchRename = defineVersionChange(choresBase, {
  since: '1.0.0',
  surface: [{ action: 'chores.oldWatch', renamedFrom: 'chores.oldStream' }],
});

const choresDef = defineModule(choresBase, {
  actions: { oldPing, oldWatch, quietWatch },
  changes: { watchRename },
  policies: {
    chore: {
      readers: defineRule(choresBase, chore, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
      }),
    },
    oldPing: { users: defineRule(choresBase, oldPing, { effect: 'allow', principal: 'user' }) },
    oldWatch: { users: defineRule(choresBase, oldWatch, { effect: 'allow', principal: 'user' }) },
    quietWatch: {
      users: defineRule(choresBase, quietWatch, { effect: 'allow', principal: 'user' }),
    },
  },
});
interface Chores extends ModuleType<typeof choresDef> {}
const chores: Chores = choresDef;

/** The API versions of `deprecatedStreamApp`: the older one is deprecated from 2026-11-05 and retired after 2026-12-01. */
export const deprecatedVersions = { older: '2026-11-04', head: '2026-11-11' } as const;

/** The stream app with a deprecated query, a deprecated subscription (renamed since the older version) and a deprecated older API version. */
export const deprecatedStreamApp = defineApp({
  id: 'deprecated-streams',
  modules: [live, library, loans, chores],
  api: defineApiVersions({
    [deprecatedVersions.older]: { deprecated: { at: '2026-11-05', sunset: '2026-12-01' } },
    [deprecatedVersions.head]: { changes: ['chores.watchRename'] },
  }),
});
