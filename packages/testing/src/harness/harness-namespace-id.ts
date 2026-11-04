/** The id of the namespace a tenant of a test runtime lives in; `null` is the backend's own. */
export function harnessNamespaceId(tenantId: string | null): string {
  return tenantId === null ? 'ns-backend' : `ns-${tenantId}`;
}
