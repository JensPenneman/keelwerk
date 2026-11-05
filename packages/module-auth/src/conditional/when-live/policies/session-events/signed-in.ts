import { defineRule, within } from '@keelwerk/core';
import { authBase } from '../../../../base.ts';
import { sessionEvents } from '../../actions/session-events.ts';
import { whenLive } from '../../condition.ts';

export const signedIn = defineRule(within(authBase, whenLive), sessionEvents, {
  effect: 'allow',
  principal: 'user',
});
