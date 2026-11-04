import { defineEntity, type EntityType, field } from '@keelwerk/core';

const positionDef = defineEntity({
  prefix: 'pos',
  fields: {
    deviceId: field.ref.own('device').index(),
    at: field.instant(),
    lat: field.float(),
    lon: field.float(),
  },
  indexes: [{ fields: ['deviceId', 'at'], unique: true }],
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

export interface Position extends EntityType<typeof positionDef> {}
export const position: Position = positionDef;
