import { defineEntity, type EntityType, field } from '@keelwerk/core';

const passDef = defineEntity({
  prefix: 'pass',
  dataSubject: 'holder',
  fields: {
    holder: field.string().index(),
    /** A change that leaves the pass valid: the live tests change a pass without revoking it. */
    label: field.string({ maxLength: 100 }).optional(),
    revokedAt: field.instant().optional(),
  },
  generated: { set: false },
});

export interface Pass extends EntityType<typeof passDef> {}
export const pass: Pass = passDef;
