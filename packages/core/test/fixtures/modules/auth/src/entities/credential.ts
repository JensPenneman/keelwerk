import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const credentialDef = defineEntity({
  prefix: 'cred',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    kind: field.enum(['password', 'passkey']),
    identifier: field.string({ format: 'email' }).optional().personal({ normalize: 'email' }),
    verifier: field.verifier(),
    recoveryKey: field.secret().optional(),
    lastUsedAt: field.instant().optional().maskable(),
    revokedAt: field.instant().optional(),
  },
  events: { revoked: shape({ at: field.instant(), reason: field.string().optional() }) },
  evolve: { revoked: (state, event) => ({ ...state, revokedAt: event.at }) },
  generated: { set: false },
});

export interface Credential extends EntityType<typeof credentialDef> {}
export const credential: Credential = credentialDef;
