/**
 * Where a unit runs. `namespace` is kernel-internal (migrations, provisioning, maintenance that
 * touches no tenant rows): it never appends events and is never handed to module code.
 */
export type StorageScope =
  | { readonly level: 'tenant'; readonly backendId: string; readonly tenantId: string }
  | { readonly level: 'backend'; readonly backendId: string }
  | { readonly level: 'deployment' }
  | { readonly level: 'namespace'; readonly reason: string };
