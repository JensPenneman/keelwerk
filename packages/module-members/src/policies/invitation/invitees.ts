import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';

/** Any signed-in person may try a token; the token itself is the proof. */
export const invitees = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['accept'],
  principal: 'user',
  reason: 'A signed-in person accepts an invitation with its token.',
});
