import type { StorageScope } from '@keelwerk/core';
import { backend } from './backend.ts';

/** The storage scope of one tenant under the test backend. */
export const storageTenant = (tenantId: string): StorageScope => ({
  level: 'tenant',
  backendId: backend,
  tenantId,
});
