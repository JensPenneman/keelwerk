import { tenantScope } from './tenant-scope.ts';

export const tenant1 = tenantScope.level === 'tenant' ? tenantScope.tenantId : '';
