/** How a request finds its tenant (section 3.5). */
export interface TenantResolver {
  readonly kind: 'tenantResolver';
  readonly by: 'hostname' | 'scopeKey' | 'header';
  readonly header?: string;
}
