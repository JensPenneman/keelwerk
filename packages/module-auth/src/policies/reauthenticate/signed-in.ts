import { defineRule } from '@keelwerk/core';
import { reauthenticate } from '../../actions/reauthenticate.ts';
import { authBase } from '../../base.ts';

export const signedIn = defineRule(authBase, reauthenticate, {
  effect: 'allow',
  principal: 'user',
});
