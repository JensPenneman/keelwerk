import { defineError } from '@keelwerk/core';

export const templated = defineError(`accounts.email_taken_2`, { kind: 'conflict' });
