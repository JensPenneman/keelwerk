import { defineError } from '@keelwerk/core';

export const revoked = defineError('api-keys.key_revoked_2', { kind: 'conflict' });
