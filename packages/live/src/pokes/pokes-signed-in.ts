import { defineRule } from '@keelwerk/core';
import { liveBase } from '../live-base.ts';
import { pokesAction } from './pokes-action.ts';

/** Any signed-in user may follow the pokes of their scope. */
export const pokesSignedIn = defineRule(liveBase, pokesAction, {
  effect: 'allow',
  principal: 'user',
});
