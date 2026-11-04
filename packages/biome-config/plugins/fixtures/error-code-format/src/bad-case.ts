import { defineError } from '@keelwerk/core';

export const upper = defineError("Accounts.email_taken", { kind: 'conflict' }); // expect: plugin/error-code-format
