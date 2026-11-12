import { defineRule } from '@keelwerk/core';
import { create } from '../../actions/create.ts';
import { apiKeysBase } from '../../base.ts';
import { keyResolverId } from '../../lib/key-resolver-id.ts';

export const signedIn = defineRule(apiKeysBase, create, {
  effect: 'allow',
  principal: 'user',
  when: (ctx) => ctx.principal.via !== keyResolverId,
  reason: 'A signed-in person creates keys; a key creates none.',
});
