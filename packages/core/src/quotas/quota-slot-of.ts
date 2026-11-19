/** `<dimension>@<backendId>@<tenantId>`: the identity of a tenant's row. */
export function quotaSlotOf(dimension: string, backendId: string, tenantId: string): string {
  return `${dimension}@${backendId}@${tenantId}`;
}
