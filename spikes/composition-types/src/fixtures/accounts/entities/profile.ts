import { defineEntity } from '../../../define-entity.ts';
import { field } from '../../../field.ts';
import { shape } from '../../../shape.ts';

export const profile = defineEntity({
  prefix: 'prof',
  dataSubject: 'id',
  fields: {
    displayName: field.string({ maxLength: 120 }).merge('lww'),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ queries: ['prefix'] })
      .maskable(),
    locale: field.string().optional(),
    deactivatedAt: field.instant().optional(),
  },
  indexes: [{ fields: ['displayName'] }],
  events: { deactivated: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { deactivated: (state, event) => ({ ...state, deactivatedAt: event.at }) },
});
