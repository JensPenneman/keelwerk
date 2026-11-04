import { defineEntity, type EntityType, field } from '@keelwerk/core';

const teamDef = defineEntity({ prefix: 'team', fields: { name: field.string() } });

export interface Team extends EntityType<typeof teamDef> {}
export const team: Team = teamDef;
