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
    /**
     * The invited address: sealed, found only by its keyed digest, unique among pending
     * invitations. Absent once the invitation ended without being accepted: it is dropped then.
     */
    email: field.string({ format: 'email' }).personal({ normalize: 'email' }).optional(),
    role: field.enum(memberRoles),
    status: field.enum(['pending', 'accepted', 'withdrawn', 'expired']),
    /** The inviting person, a reference and not a data subject; absent for the owner's invitation. */
    invitedBy: field.subject().optional(),
    publicId: field.string().unique(),
    tokenVerifier: field.verifier(),
    expiresAt: field.instant(),
    acceptedAt: field.instant().optional(),
  },
  indexes: [
    // A declared unique index holds among live rows only, as memory checks it (the SQL index states it).
    {
      fields: ['email'],
      unique: true,
      where: { status: 'pending', archivedAt: { isNull: true } },
    },
    // One owner invitation is live at a time, even when two operators bring a tenant up at once.
    {
      fields: ['role'],
      unique: true,
      where: { role: 'owner', status: 'pending', archivedAt: { isNull: true } },
    },
  ],
  generated: { create: false },
});

export interface Invitation extends EntityType<typeof invitationDef> {}
export const invitation: Invitation = invitationDef;
