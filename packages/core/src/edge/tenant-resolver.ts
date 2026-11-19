/**
 * One entry of `defineDeployment({ tenantResolution })`. 'hostname' (over `core.domain`) and
 * 'header' are tried in deployment order; 'path' resolves `/t/<tenant TypeID>` in M2 and decides
 * over the others, which can only veto it; 'scopeKey' is refused at boot with the problem
 * `scopeDirectoryUnavailable` until the scope directory exists (S-146).
 */
export type TenantResolver =
  | { readonly kind: 'hostname' }
  | { readonly kind: 'header'; readonly header: string; readonly backendHeader?: string }
  | { readonly kind: 'scopeKey' }
  | { readonly kind: 'path' };
