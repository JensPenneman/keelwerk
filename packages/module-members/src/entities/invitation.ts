import { defineEntity, type EntityType, field } from '@keelwerk/core';
import { memberRoles } from '../lib/member-roles.ts';

const invitationDef = defineEntity({
  prefix: 'minv',
  dataSubject: 'subject',
  history: 'state',
  reason: 'An invitation is issued once and settled once; the membership carries the trail.',
  fields: {
    /** The data subject: the invitation's own id while pending, the accepting person's after accept. */
    subject: field.subject().index(),
    /** The invited address: sealed, found only by its keyed digest, unique among pending invitations. */
    email: field.string({ format: 'email' }).personal({ normalize: 'email' }),
    role: field.enum(memberRoles),
    status: field.enum(['pending', 'accepted', 'withdrawn', 'expired']),
    /** The inviting person, a reference and not a data subject; absent for the owner's invitation. */
    invitedBy: field.subject().optional(),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    expiresAt: field.instant(),
    acceptedAt: field.instant().optional(),
  },
  indexes: [{ fields: ['email'], unique: true, where: { status: 'pending' } }],
  generated: { create: false },
});

export interface Invitation extends EntityType<typeof invitationDef> {}
export const invitation: Invitation = invitationDef;
