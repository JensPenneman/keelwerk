import { defineEntity, type EntityType, field } from '@keelwerk/core';

const sessionDef = defineEntity({
  prefix: 'sess',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    credentialId: field.ref.own('credential'),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    revokedAt: field.instant().optional(),
  },
  history: 'state',
  reason: 'Sessions are replaced, not edited.',
  generated: { set: false },
});

export interface Session extends EntityType<typeof sessionDef> {}
export const session: Session = sessionDef;
