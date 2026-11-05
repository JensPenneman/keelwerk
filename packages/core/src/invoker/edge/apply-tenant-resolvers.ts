import { normalizeHost } from '../../core-module/normalize-host.ts';
import type { TenantResolver } from '../../edge/tenant-resolver.ts';
import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';
import type { BackendRecord } from '../backend-record.ts';
import type { Carrier } from '../carrier.ts';
import type { ScopeLookup } from '../scope-lookup.ts';
import type { TenantRecord } from '../tenant-record.ts';

/** The host as the edge resolves it (the form `core.domain` stores); a name that is no host name matches nothing. */
function hostOf(host: string): string | undefined {
  try {
    return normalizeHost(host);
  } catch (error) {
    if (isKeelwerkError(error) && error.kind === 'validation') return undefined;
    throw error;
  }
}

async function byTenantId(
  directory: ScopeLookup,
  tenantId: string,
  backendId: string | undefined,
): Promise<{ backend: BackendRecord; tenant: TenantRecord } | undefined> {
  const tenant = await directory.tenant(tenantId);
  if (tenant === undefined) return undefined;
  if (backendId !== undefined && backendId !== tenant.backendId) return undefined;
  const backend = await directory.backend(tenant.backendId);
  return backend === undefined ? undefined : { backend, tenant };
}

async function resolveOne(
  resolver: TenantResolver,
  carrier: Carrier,
  directory: ScopeLookup,
): Promise<Omit<TenantResolution, 'resolvedBy'> | undefined> {
  if (resolver.kind === 'hostname') {
    if (carrier.host === undefined) return undefined;
    const host = hostOf(carrier.host);
    if (host === undefined) return undefined;
    const hit = await directory.hostname(host);
    if (hit === undefined) return undefined;
    if (hit.tenantId !== null) return byTenantId(directory, hit.tenantId, hit.backendId);
    const backend = await directory.backend(hit.backendId);
    return backend === undefined ? undefined : { backend, tenant: null };
  }
  if (resolver.kind === 'header') {
    const tenantValue = carrier.headers?.[resolver.header.toLowerCase()];
    const backendValue =
      resolver.backendHeader === undefined
        ? undefined
        : carrier.headers?.[resolver.backendHeader.toLowerCase()];
    if (tenantValue !== undefined) return byTenantId(directory, tenantValue, backendValue);
    if (backendValue === undefined) return undefined;
    const backend = await directory.backend(backendValue);
    return backend === undefined ? undefined : { backend, tenant: null };
  }
  return undefined;
}

/** The backend, and the tenant when the resolver named one, with the resolver that matched. */
export interface TenantResolution {
  readonly backend: BackendRecord;
  readonly tenant: TenantRecord | null;
  readonly resolvedBy: TenantResolver['kind'];
}

/**
 * Tries the deployment's tenant resolvers in order (S-20): `byHostname` over `core.domain` and
 * `byHeader`. A resolver whose input is absent, or names nothing known, passes to the next; the
 * rest ('scopeKey', 'path') never match here, because creation refuses them.
 */
export async function applyTenantResolvers(
  resolvers: readonly TenantResolver[],
  carrier: Carrier,
  directory: ScopeLookup,
): Promise<TenantResolution | undefined> {
  for (const resolver of resolvers) {
    const found = await resolveOne(resolver, carrier, directory);
    if (found !== undefined) return { ...found, resolvedBy: resolver.kind };
  }
  return undefined;
}
