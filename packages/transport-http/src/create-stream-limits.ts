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
 * client address), its tenant and the process. A stream past a bound is refused with `core.quota_exceeded` and counts nowhere; the release
 * a taken stream gets gives its count back once.
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
  return {
    take: (session, address) => {
      const principal = principalKeyOf(session, address);
      const tenant = tenantKeyOf(session);
      const isAnonymous = session.principal.kind === 'anonymous';
      if (
        total >= bounds.total ||
        (tenants.get(tenant) ?? 0) >= bounds.perTenant ||
        (principals.get(principal) ?? 0) >= bounds.perPrincipal ||
        (isAnonymous && (anonymous.get(tenant) ?? 0) >= bounds.perTenantAnonymous)
      ) {
        throw coreError('core.quota_exceeded', { message: 'Too many streams are open.' });
      }
      total += 1;
      counted(tenants, tenant, 1);
      counted(principals, principal, 1);
      if (isAnonymous) counted(anonymous, tenant, 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        counted(tenants, tenant, -1);
        counted(principals, principal, -1);
        if (isAnonymous) counted(anonymous, tenant, -1);
      };
    },
  };
}
