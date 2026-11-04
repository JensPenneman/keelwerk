import { defineError } from '@keelwerk/core';

export const dashed = defineError('accounts.email-taken', { kind: 'conflict' }); // expect: plugin/error-code-format
