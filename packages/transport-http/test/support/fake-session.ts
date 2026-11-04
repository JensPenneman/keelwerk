import type { InvocationSession, Principal } from '@keelwerk/core';

const anonymous: Principal = {
  kind: 'anonymous',
  scope: { backend: null, tenant: null },
  claims: {},
  roles: [],
  memberships: [],
  via: 'none',
  ref: null,
};

/** A session value for tests; the real invoker keeps its own in a private set. */
export function fakeSession(overrides: Partial<InvocationSession> = {}): InvocationSession {
  const session: InvocationSession = {
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't1' },
    app: 'library',
    principal: anonymous,
    apiVersion: '2026-11-01',
    deprecation: null,
    resolvedBy: 'hostname',
    revalidate: async () => ({ ok: true, value: session }),
    ...overrides,
  };
  return session;
}
