import { defineRule } from '@keelwerk/core';
import { addBookAt } from './add-book-at.ts';
import { laterBase } from './base.ts';
import { ping } from './ping.ts';
import { pingAt } from './ping-at.ts';

export const laterCallers = defineRule(laterBase, addBookAt, {
  effect: 'allow',
  principal: 'user',
});

export const pingAtCallers = defineRule(laterBase, pingAt, {
  effect: 'allow',
  principal: 'user',
});

export const pingRunners = defineRule(laterBase, ping, {
  effect: 'allow',
  principal: 'service',
});
