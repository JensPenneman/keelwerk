import { defineRule } from '@keelwerk/core';
import { register } from '../../actions/register.ts';
import { accountsBase } from '../../base.ts';

/** An operator may always register a profile, whatever `allowSelfRegistration` says (17.2.1). */
export const operator = defineRule(accountsBase, register, {
  effect: 'allow',
  principal: 'operator',
});
