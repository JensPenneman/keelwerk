import { defineEntity, type EntityType, field } from '@keelwerk/core';

const resetTokenDef = defineEntity({
  prefix: 'rtok',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    credentialId: field.ref.own('credential'),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    expiresAt: field.instant(),
    usedAt: field.instant().optional(),
  },
  history: 'state',
  reason: 'A reset token is issued once and consumed once; the credential carries the audit trail.',
  generated: { set: false },
});

export interface ResetToken extends EntityType<typeof resetTokenDef> {}
export const resetToken: ResetToken = resetTokenDef;
