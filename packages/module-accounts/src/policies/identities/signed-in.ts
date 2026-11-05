import { defineRule } from '@keelwerk/core';
import { identities } from '../../actions/identities.ts';
import { accountsBase } from '../../base.ts';

export const signedIn = defineRule(accountsBase, identities, {
  effect: 'allow',
  principal: 'user',
});
