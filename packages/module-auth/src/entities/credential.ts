import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const credentialDef = defineEntity({
  prefix: 'cred',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    kind: field.enum(['password', 'passkey']),
    identifier: field.string({ format: 'email' }).optional().personal({ normalize: 'email' }),
    verifier: field.verifier(),
    label: field.string().optional().merge('lww'),
    lastUsedAt: field.instant().optional().maskable(),
    revokedAt: field.instant().optional(),
  },
  indexes: [
    {
      fields: ['identifier'],
      unique: true,
      where: { kind: 'password', revokedAt: { isNull: true } },
    },
  ],
  events: {
    revoked: shape({ at: field.instant(), reason: field.string().optional() }),
    signedUp: shape({ displayName: field.string({ maxLength: 120 }).optional() }),
  },
  evolve: {
    revoked: (state, event) => ({ ...state, revokedAt: event.at }),
    signedUp: (state) => state,
  },
  generated: { set: false },
});

export interface Credential extends EntityType<typeof credentialDef> {}
export const credential: Credential = credentialDef;
