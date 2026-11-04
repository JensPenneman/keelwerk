import type { TenantResolver } from '../edge/tenant-resolver.ts';

/** Resolves the tenant from a request header; `backendHeader` names the header of the backend when it is not implied. */
export function byHeader(
  header: string,
  options: { readonly backendHeader?: string } = {},
): TenantResolver {
  return options.backendHeader === undefined
    ? { kind: 'header', header }
    : { kind: 'header', header, backendHeader: options.backendHeader };
}
