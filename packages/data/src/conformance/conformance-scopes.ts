import type { ConformanceScopeSet } from './conformance-scope-set.ts';

const backendId = '00000000-0000-4000-8000-0000000000b1';
const otherBackendId = '00000000-0000-4000-8000-0000000000b2';

/** `tenantA` and `tenantB` belong to `backend`; `tenantC` to `otherBackend`. */
export const conformanceScopes: ConformanceScopeSet = {
  tenantA: { level: 'tenant', backendId, tenantId: '00000000-0000-4000-8000-0000000000a1' },
  tenantB: { level: 'tenant', backendId, tenantId: '00000000-0000-4000-8000-0000000000a2' },
  tenantC: {
    level: 'tenant',
    backendId: otherBackendId,
    tenantId: '00000000-0000-4000-8000-0000000000a3',
  },
  backend: { level: 'backend', backendId },
  otherBackend: { level: 'backend', backendId: otherBackendId },
  deployment: { level: 'deployment' },
};
