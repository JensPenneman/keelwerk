import { defineError } from '@keelwerk/core';

export const templated = defineError(`accounts.EmailTaken`, { kind: 'conflict' }); // expect: plugin/error-code-format
