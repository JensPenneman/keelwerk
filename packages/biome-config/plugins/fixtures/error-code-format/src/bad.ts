import { defineError } from '@keelwerk/core';

export const camel = defineError('accounts.emailTaken', { kind: 'conflict' }); // expect: plugin/error-code-format
