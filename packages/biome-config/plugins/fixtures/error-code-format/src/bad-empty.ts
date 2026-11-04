import { defineError } from '@keelwerk/core';

export const trailing = defineError('accounts.', { kind: 'conflict' }); // expect: plugin/error-code-format
