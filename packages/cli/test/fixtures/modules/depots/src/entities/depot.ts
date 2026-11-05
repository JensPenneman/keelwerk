import { defineEntity, type EntityType, field } from '@keelwerk/core';

const depotDef = defineEntity({ prefix: 'depo', fields: { name: field.string() } });

export interface Depot extends EntityType<typeof depotDef> {}
export const depot: Depot = depotDef;
