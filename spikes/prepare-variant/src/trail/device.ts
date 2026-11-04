import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const deviceDef = defineEntity({
  prefix: 'dev',
  fields: {
    name: field.string({ maxLength: 80 }),
    lastSeenAt: field.instant().optional(),
    positionCount: field.integer().default(0),
  },
  events: {
    updated: shape({ lastSeenAt: field.instant(), added: field.integer() }),
  },
  evolve: {
    updated: (state, event) => ({
      ...state,
      lastSeenAt: event.lastSeenAt,
      positionCount: state.positionCount + event.added,
    }),
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

export interface Device extends EntityType<typeof deviceDef> {}
export const device: Device = deviceDef;
