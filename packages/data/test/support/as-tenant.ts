import type { Settings } from './settings.ts';

export const asTenant = (id: string): Settings => ({ 'keelwerk.tenant_id': id });
