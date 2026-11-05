import { defineEntity, type EntityType, field } from '@keelwerk/core';

const benchItemDef = defineEntity({
  prefix: 'bit',
  fields: {
    label: field.string({ maxLength: 80 }),
    hits: field.integer().default(0),
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

export interface BenchItem extends EntityType<typeof benchItemDef> {}
export const benchItem: BenchItem = benchItemDef;
