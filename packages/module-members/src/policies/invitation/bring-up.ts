import { defineRule } from '@keelwerk/core';
import { membersBase } from '../../base.ts';
import { invitation } from '../../entities/invitation.ts';

export const bringUp = defineRule(membersBase, invitation, {
  effect: 'allow',
  actions: ['createOwner'],
  principal: 'operator',
  reason: 'An operator brings a tenant up by inviting its first owner.',
});
