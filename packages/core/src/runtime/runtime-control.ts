import type { BackendInput } from '../control/create-backend.ts';
import type { TenantInput } from '../control/create-tenant.ts';

/**
 * What an operator does to a running process (section 12.3): the programmatic form of the
 * generated `core.backend.create` and `core.tenant.create` until the generated actions are served
 * (S-26). Both write through the write path of the control store, and the new scope resolves at
 * once; `createTenant` runs the `onTenantCreated` hooks of the backend's app (S-27).
 */
export interface RuntimeControl {
  createBackend(input: BackendInput): Promise<{ readonly id: string }>;
  createTenant(input: TenantInput): Promise<{ readonly id: string }>;
}
