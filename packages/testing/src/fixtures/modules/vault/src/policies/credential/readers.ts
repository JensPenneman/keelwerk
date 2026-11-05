import { defineRule } from '@keelwerk/core';
import { vaultBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const readers = defineRule(vaultBase, credential, {
  effect: 'allow',
  actions: ['read'],
  principal: 'user',
  reason: 'A signed-in user reads every credential row.',
});
