import { defineEntity, type EntityType, field } from '@keelwerk/core';

const crewDef = defineEntity({ prefix: 'crew', fields: { name: field.string() } });

export interface Crew extends EntityType<typeof crewDef> {}
export const crew: Crew = crewDef;
