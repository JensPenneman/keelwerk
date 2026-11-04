import { defineError } from '@keelwerk/core';

export const taken = defineError('accounts.email_taken', { kind: 'conflict' });
