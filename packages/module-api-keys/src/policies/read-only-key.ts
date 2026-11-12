import { defineRule } from '@keelwerk/core';
import { apiKeysBase } from '../base.ts';
import { isReadOnlyKey } from '../lib/is-read-only-key.ts';

/** A rule over a selector (G13): a key without the write scope runs no command in any module. */
export const readOnlyKey = defineRule(
  apiKeysBase,
  { kinds: ['command'] },
  { effect: 'deny', when: isReadOnlyKey, reason: 'This API key has the read scope only.' },
);
