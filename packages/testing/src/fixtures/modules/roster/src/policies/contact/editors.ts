import { defineRule } from '@keelwerk/core';
import { rosterBase } from '../../base.ts';
import { contact } from '../../entities/contact.ts';

export const editors = defineRule(rosterBase, contact, {
  effect: 'allow',
  actions: ['read', 'write'],
  principal: 'user',
  reason: 'A signed-in user reads and edits contacts.',
});
