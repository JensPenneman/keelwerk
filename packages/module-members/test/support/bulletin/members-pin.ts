import { defineRule } from '@keelwerk/core';
import { hasRole } from '../../../src/lib/has-role.ts';
import { bulletinBase } from './base.ts';
import { pinNotice } from './pin-notice.ts';

/** The rule a module of another team writes with `hasRole`: members, admins and owners pin notices. */
export const membersPin = defineRule(bulletinBase, pinNotice, {
  effect: 'allow',
  principal: 'user',
  when: (ctx) => hasRole(ctx, 'member', 'admin', 'owner'),
});
