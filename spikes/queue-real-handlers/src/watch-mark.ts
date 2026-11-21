import { defineEntity, type EntityType, field } from '@keelwerk/core';

const watchMarkDef = defineEntity({
  prefix: 'wmk',
  fields: { itemId: field.string({ maxLength: 40 }) },
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

export interface WatchMark extends EntityType<typeof watchMarkDef> {}
export const watchMark: WatchMark = watchMarkDef;
