import { defineEntity } from '../../../define-entity.ts';
import { field } from '../../../field.ts';

export const session = defineEntity({
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
