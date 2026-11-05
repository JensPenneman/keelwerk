import { defineEntity, type EntityType, field } from '@keelwerk/core';

const sessionDef = defineEntity({
  prefix: 'sess',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    credentialId: field.ref.own('credential'),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    authenticatedAt: field.instant(),
    lastSeenAt: field.instant(),
    idleExpiresAt: field.instant(),
    absoluteExpiresAt: field.instant(),
    revokedAt: field.instant().optional(),
    rotatedFrom: field.ref.own('session').optional(),
    userAgent: field.string({ maxLength: 512 }).optional().personal(),
    address: field.string({ maxLength: 64 }).optional().personal(),
  },
  history: 'state',
  reason: 'Sessions are replaced, not edited; the chain of credentials is the audit trail.',
  generated: { set: false },
});

export interface Session extends EntityType<typeof sessionDef> {}
export const session: Session = sessionDef;
