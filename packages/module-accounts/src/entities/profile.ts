import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const profileDef = defineEntity({
  prefix: 'prof',
  dataSubject: 'id',
  fields: {
    displayName: field.string({ maxLength: 120 }).index().merge('lww'),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ normalize: 'email', queries: ['prefix'] })
      .maskable(),
    locale: field.string().default('nl-BE'),
    deactivatedAt: field.instant().optional(),
  },
  events: { deactivated: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { deactivated: (state, event) => ({ ...state, deactivatedAt: event.at }) },
});

export interface Profile extends EntityType<typeof profileDef> {}
export const profile: Profile = profileDef;
