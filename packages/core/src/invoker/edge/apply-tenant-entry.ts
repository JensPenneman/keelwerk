import { tenantEntryWindowMs } from '../../core-module/tenant-entry-window-ms.ts';
import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import { parseTypeId } from '../../ids/parse-type-id.ts';
import type { Principal } from '../../principals/principal.ts';
import type { Carrier } from '../carrier.ts';
import type { InvokerEnv } from '../invoker-env.ts';
import type { ResolvedScope } from '../resolved-scope.ts';
import { tenantScopeOf } from '../stages/tenant-scope-of.ts';

function notFound(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'not_found', code: 'core.not_found', message });
}

/**
 * The operator's tenant marker (sections 8.8 and 16.8.2): an operator carrier that sends
 * `x-keelwerk-tenant` works inside that tenant for the request, provided the same operator
 * entered it through `core.tenant.enter` in the last 12 hours. The principal stays the operator
 * and the app's rules decide what it may do. Without the header the session stays at deployment
 * scope. `not_found` for a malformed or unknown tenant or another backend, `unavailable` for a
 * suspended one, `forbidden` with `core.tenant_not_entered` without an entry (every marker is
 * refused when the invoker has no `tenantEntry`).
 */
export async function applyTenantEntry(
  env: InvokerEnv,
  carrier: Carrier,
  resolved: ResolvedScope,
  principal: Principal,
): Promise<ResolvedScope> {
  const marker = carrier.headers?.['x-keelwerk-tenant'];
  if (marker === undefined || resolved.resolvedBy !== 'local' || principal.kind !== 'operator') {
    return resolved;
  }
  const tenantId = parseTypeId(marker, 'tnt');
  const backendMarker = carrier.headers?.['x-keelwerk-backend'];
  const backendId = backendMarker === undefined ? undefined : parseTypeId(backendMarker, 'bknd');
  if (tenantId === undefined || (backendMarker !== undefined && backendId === undefined)) {
    throw notFound('The tenant does not exist.');
  }
  const tenant = await env.options.directory.tenant(tenantId);
  if (tenant === undefined || (backendId !== undefined && backendId !== tenant.backendId)) {
    throw notFound('The tenant does not exist.');
  }
  const backend = await env.options.directory.backend(tenant.backendId);
  if (backend === undefined) throw notFound('The tenant does not exist.');
  const entered = tenantScopeOf(env, backend, tenant, 'local');
  const at = await env.options.tenantEntry?.(tenant.id, { via: principal.via, id: principal.id });
  const fresh =
    at !== undefined &&
    env.options.clock.now().epochMilliseconds - at.epochMilliseconds <= tenantEntryWindowMs;
  if (!fresh) {
    throw new KeelwerkError({
      kind: 'forbidden',
      code: 'core.tenant_not_entered',
      message: 'Enter the tenant first (core.tenant.enter).',
    });
  }
  return entered;
}
