import { defineRule } from '@keelwerk/core';
import { laterBase } from './base.ts';
import { cancelTimerKey } from './cancel-timer-key.ts';

export const cancelCallers = defineRule(laterBase, cancelTimerKey, {
  effect: 'allow',
  principal: 'user',
});
