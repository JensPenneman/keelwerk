import { defineEntity, type EntityType, field } from '@keelwerk/core';
import { memberRoles } from '../lib/member-roles.ts';

const membershipDef = defineEntity({
  prefix: 'mbr',
  dataSubject: 'subject',
  fields: {
    /** The member, a data subject (14.7.4); one live membership per person and tenant. */
    subject: field.subject().unique(),
    role: field.enum(memberRoles),
    /** The invitation the member accepted, absent for a membership made another way. */
    invitationId: field.ref.own('invitation').optional(),
  },
  // One owner per tenant, held by the store: two accepts of owner invitations at once cannot both
  // win. An archived (erased) owner releases the slot.
  indexes: [
    { fields: ['role'], unique: true, where: { role: 'owner', archivedAt: { isNull: true } } },
  ],
  generated: { create: false },
});

/** Not `Membership`: core exports that name for the principal's membership. */
export interface MembershipEntity extends EntityType<typeof membershipDef> {}
export const membership: MembershipEntity = membershipDef;
