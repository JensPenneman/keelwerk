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

const note = defineEntity({ prefix: 'gnote', fields: { text: field.string() } });

interface GatedBase extends ModuleBaseType<typeof gatedBaseDef> {}

const gatedBaseDef = defineModuleBase({
  id: 'gated',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { note },
});
const gatedBase: GatedBase = gatedBaseDef;

/** A subscription only a viewer may open: its own gate, which a revalidation decides again. */
const watch = defineSubscription(gatedBase, {
  event: shape({ type: field.string(), id: field.string() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(ctx.live.entity('gated', 'note', { from: 'now', after: resume }), (change) => ({
      type: change.type,
      id: change.id,
    })),
});

const gatedDef = defineModule(gatedBase, {
  actions: { watch },
  policies: {
    watch: {
      viewers: defineRule(gatedBase, watch, {
        effect: 'allow',
        principal: 'user',
        when: (ctx) => ctx.principal.roles.includes('viewer'),
      }),
    },
    note: {
      all: defineRule(gatedBase, note, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
  },
});

/** A module with one entity and a subscription gated by a role. */
export interface Gated extends ModuleType<typeof gatedDef> {}
export const gated: Gated = gatedDef;
