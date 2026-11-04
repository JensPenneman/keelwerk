import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const pendingConnectDef = defineEntity({
  prefix: 'pcn',
  fields: {
    state: field.string({ maxLength: 64 }).unique(),
    consumedAt: field.instant().optional(),
  },
  events: {
    consumed: shape({ at: field.instant() }),
  },
  evolve: {
    consumed: (state, event) => ({ ...state, consumedAt: event.at }),
  },
  generated: {
    get: false,
    query: false,
    changes: false,
    queryChanges: false,
    set: false,
    history: false,
    watch: false,
  },
});

export interface PendingConnect extends EntityType<typeof pendingConnectDef> {}
export const pendingConnect: PendingConnect = pendingConnectDef;
