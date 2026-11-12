import type { InvocationSession } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { addressBucketOf } from './address-bucket-of.ts';
import type { StreamLimits } from './stream-limits.ts';

function tenantKeyOf(session: InvocationSession): string {
  const { scope } = session;
  if (scope.level === 'tenant') return `tenant:${scope.backendId}:${scope.tenantId}`;
  return scope.level === 'backend' ? `backend:${scope.backendId}` : 'deployment';
}

function principalKeyOf(session: InvocationSession, address: string): string {
  const { principal } = session;
  if (principal.kind === 'anonymous')
    return `${tenantKeyOf(session)}:anonymous@${addressBucketOf(address)}`;
  const who =
    principal.kind === 'user'
      ? String(principal.subject)
      : (principal.ref?.principalId ?? principal.kind);
  return `${tenantKeyOf(session)}:${principal.kind}:${who}`;
}

function counted(counts: Map<string, number>, key: string, by: 1 | -1): void {
  const next = (counts.get(key) ?? 0) + by;
  if (next <= 0) counts.delete(key);
  else counts.set(key, next);
}

/**
 * The counters of one host: each stream counts once against its principal (an anonymous caller: its
 * client address), its tenant and the process; each subscription of a socket counts against its
 * tenant and the process; an anonymous one counts against its client address and the tenant's
 * anonymous bound too, so one address holds its streams over SSE and sockets together, and any other
 * one against no principal (the socket is the principal's connection). Past a bound it is refused with
 * `core.quota_exceeded` and counts nowhere; the release it gets gives its count back once.
 */
export function createStreamLimits(bounds: {
  readonly perPrincipal: number;
  readonly perTenant: number;
  readonly perTenantAnonymous: number;
  readonly total: number;
}): StreamLimits {
  const principals = new Map<string, number>();
  const tenants = new Map<string, number>();
  const anonymous = new Map<string, number>();
  let total = 0;
  const admit = (session: InvocationSession, principal: string | undefined): (() => void) => {
    const tenant = tenantKeyOf(session);
    const isAnonymous = session.principal.kind === 'anonymous';
    if (
      total >= bounds.total ||
      (tenants.get(tenant) ?? 0) >= bounds.perTenant ||
      (principal !== undefined && (principals.get(principal) ?? 0) >= bounds.perPrincipal) ||
      (isAnonymous && (anonymous.get(tenant) ?? 0) >= bounds.perTenantAnonymous)
    ) {
      throw coreError('core.quota_exceeded', { message: 'Too many streams are open.' });
    }
    total += 1;
    counted(tenants, tenant, 1);
    if (principal !== undefined) counted(principals, principal, 1);
    if (isAnonymous) counted(anonymous, tenant, 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      total -= 1;
      counted(tenants, tenant, -1);
      if (principal !== undefined) counted(principals, principal, -1);
      if (isAnonymous) counted(anonymous, tenant, -1);
    };
  };
  return {
    take: (session, address) => admit(session, principalKeyOf(session, address)),
    takeSubscription: (session, address) =>
      admit(
        session,
        session.principal.kind === 'anonymous' ? principalKeyOf(session, address) : undefined,
      ),
  };
}
