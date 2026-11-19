import { normalizeHost } from '../../core-module/normalize-host.ts';
import type { TenantResolver } from '../../edge/tenant-resolver.ts';
import { isKeelwerkError } from '../../errors/is-keelwerk-error.ts';
import { parseTypeId } from '../../ids/parse-type-id.ts';
import type { BackendRecord } from '../backend-record.ts';
import type { Carrier } from '../carrier.ts';
import type { ScopeLookup } from '../scope-lookup.ts';
import type { TenantRecord } from '../tenant-record.ts';
import { tenantPathOf } from './tenant-path-of.ts';

/** The host as the edge resolves it (the form `core.domain` stores); a name that is no host name matches nothing. */
function hostOf(host: string): string | undefined {
  try {
    return normalizeHost(host);
  } catch (error) {
    if (isKeelwerkError(error) && error.kind === 'validation') return undefined;
    throw error;
  }
}

/**
 * The id a tenant or backend header value names. (The tenant path segment does not use this
 * function: it names an id only as the TypeID, see `applyTenantResolvers`.) A TypeID
 * of the prefix decodes to its uuid and any other TypeID shape (an underscore, a wrong prefix, a
 * bad suffix) names nothing; text without an underscore is an id as stored and is looked up as it
 * is.
 */
function idOf(value: string, prefix: string): string | undefined {
  return value.includes('_') ? parseTypeId(value, prefix) : value;
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
    const backendText =
      resolver.backendHeader === undefined
        ? undefined
        : carrier.headers?.[resolver.backendHeader.toLowerCase()];
    const backendValue = backendText === undefined ? undefined : idOf(backendText, 'bknd');
    if (backendText !== undefined && backendValue === undefined) return undefined;
    if (tenantValue !== undefined) {
      // The header carries the tenant's TypeID; the directory is keyed by its uuid.
      const tenantId = idOf(tenantValue, 'tnt');
      if (tenantId === undefined) return undefined;
      return byTenantId(directory, tenantId, backendValue);
    }
    if (backendValue === undefined) return undefined;
    const backend = await directory.backend(backendValue);
    return backend === undefined ? undefined : { backend, tenant: null };
  }
  return undefined;
}

/** Whether a resolver's answer is compatible with the tenant the path named. */
function agrees(
  found: Pick<TenantResolution, 'backend' | 'tenant'>,
  named: { readonly backend: BackendRecord; readonly tenant: TenantRecord },
): boolean {
  if (found.backend.id !== named.backend.id) return false;
  return found.tenant === null || found.tenant.id === named.tenant.id;
}

/** The backend, and the tenant when the resolver named one, with the resolver that matched. */
export interface TenantResolution {
  readonly backend: BackendRecord;
  readonly tenant: TenantRecord | null;
  readonly resolvedBy: TenantResolver['kind'];
  /**
   * The tenant path prefix the path resolver consumed, as sent (`/t/<tenant TypeID>`); absent
   * otherwise.
   */
  readonly tenantPrefix?: string;
}

/**
 * Tries the deployment's tenant resolvers (S-20, S-146). Without a `path` resolver in the
 * deployment, or when the request path does not start with `/t/`, the first resolver that matches
 * in deployment order answers: `byHostname` over `core.domain` and `byHeader`; a resolver whose
 * input is absent, or names nothing known, passes to the next, and 'scopeKey' never matches here.
 * Otherwise the path decides, wherever `path` stands in the order: its segment is a tenant TypeID
 * (`tnt_...`, canonical lower case; a stored uuid or any other text names nothing) that must be
 * known, and every other listed resolver that matches must agree with it (the same backend, and the
 * same tenant when it names one); a malformed, empty or unknown tenant, or a disagreement, answers
 * undefined.
 */
export async function applyTenantResolvers(
  resolvers: readonly TenantResolver[],
  carrier: Carrier,
  directory: ScopeLookup,
): Promise<TenantResolution | undefined> {
  const path =
    carrier.path !== undefined && resolvers.some((resolver) => resolver.kind === 'path')
      ? tenantPathOf(carrier.path)
      : undefined;
  if (path === undefined) {
    for (const resolver of resolvers) {
      const found = await resolveOne(resolver, carrier, directory);
      if (found !== undefined) return { ...found, resolvedBy: resolver.kind };
    }
    return undefined;
  }
  const tenantId = parseTypeId(path.segment, 'tnt');
  if (tenantId === undefined) return undefined;
  const named = await byTenantId(directory, tenantId, undefined);
  if (named === undefined) return undefined;
  for (const resolver of resolvers) {
    if (resolver.kind === 'path') continue;
    const found = await resolveOne(resolver, carrier, directory);
    if (found !== undefined && !agrees(found, named)) return undefined;
  }
  return { ...named, resolvedBy: 'path', tenantPrefix: path.prefix };
}
