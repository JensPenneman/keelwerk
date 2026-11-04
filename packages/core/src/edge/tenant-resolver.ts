/**
 * One entry of `defineDeployment({ tenantResolution })`, tried in deployment order. M1 resolves
 * 'hostname' (over `core.domain`) and 'header'; 'scopeKey' and 'path' are refused at boot with the
 * problem `scopeDirectoryUnavailable` until the scope directory exists (gap G2).
 */
export type TenantResolver =
  | { readonly kind: 'hostname' }
  | { readonly kind: 'header'; readonly header: string; readonly backendHeader?: string }
  | { readonly kind: 'scopeKey' }
  | { readonly kind: 'path' };
