/** The roles of a member, from the most to the least powerful. One member holds exactly one. */
export const memberRoles: readonly ['owner', 'admin', 'member', 'viewer'] = [
  'owner',
  'admin',
  'member',
  'viewer',
];

/** A role of a member. */
export type MemberRole = (typeof memberRoles)[number];
