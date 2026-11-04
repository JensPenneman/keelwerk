import { defineError } from '@keelwerk/core';

export const missing = defineError('email_taken', { kind: 'conflict' }); // expect: plugin/error-code-format
